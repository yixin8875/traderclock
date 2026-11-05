//! TradeClock 核心进程：调度线程、托盘、快捷键、窗口按需创建。
//! 计时和通知全部在 Rust 里完成；没有窗口打开时进程里没有 WebView。

mod audio;
mod engine;
mod today;

use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};
use chrono_tz::Asia::Shanghai;
use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

use engine::config::{is_safe_sound_name, Config, SoundMode};
use engine::contracts::{self, ContractId};
use engine::holidays::Overrides;
use engine::market::{Calendar, EarlyClose};
use engine::news::{self as news, NewsEvent};
use engine::schedule::{Alert, Planner};
use engine::tz::{hm, local_to_utc};

/// 超过这个时间才处理到的提醒视为错过（例如电脑睡眠），不补发。
const LATE_TOLERANCE_SECS: i64 = 5;
/// 调度线程最长休眠时间。睡眠唤醒后最多这么久就会按墙上时间重算。
const MAX_WAIT: StdDuration = StdDuration::from_secs(20);

/// 托盘图标反映的三种状态。
#[derive(Clone, Copy, PartialEq, Eq)]
enum TrayState {
    Running,
    Paused,
    Closed,
}

pub struct Shared {
    cfg: Mutex<Config>,
    cal: Mutex<Calendar>,
    /// 用户自己添加的日历覆盖，和内置覆盖叠加后生成 cal
    cal_overrides: Mutex<Overrides>,
    cal_path: PathBuf,
    paused_until: Mutex<Option<DateTime<Utc>>>,
    last_alert: Mutex<Option<Alert>>,
    /// 配置或暂停状态变化时唤醒调度线程
    wake: (Mutex<u64>, Condvar),
    cfg_path: PathBuf,
    audio: audio::Audio,
    /// 财经日历（ForexFactory 官方周数据），含本周全部币种
    news: Mutex<Vec<NewsEvent>>,
    news_state: Mutex<NewsState>,
    /// 快捷键注册失败的原因，供设置页提示
    hotkey_error: Mutex<Option<String>>,
    /// 当前托盘图标状态，避免每次都重建图标
    tray_state: Mutex<Option<TrayState>>,
    /// 托盘菜单里的“状态”项
    tray_state_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    /// 托盘“快速周期”里的勾选项
    tray_periods: Mutex<Vec<(u32, CheckMenuItem<tauri::Wry>)>>,
}

#[derive(Clone, Default, Serialize)]
struct NewsState {
    /// 最近一次成功更新的时间
    updated: Option<DateTime<Utc>>,
    /// 最近一次失败的原因，成功后清空
    error: Option<String>,
}

impl Shared {
    fn poke(&self) {
        let (m, cv) = &self.wake;
        *m.lock().unwrap() += 1;
        cv.notify_all();
    }
    fn paused(&self, t: DateTime<Utc>) -> bool {
        self.paused_until.lock().unwrap().is_some_and(|p| p > t)
    }
    /// 按当前配置、日历和财经数据生成调度器输入的快照
    fn snapshot(&self) -> (Config, Calendar, Vec<NewsEvent>) {
        (self.cfg.lock().unwrap().clone(), self.cal.lock().unwrap().clone(), self.news.lock().unwrap().clone())
    }
}

type Ctx<'a> = State<'a, Arc<Shared>>;

// ---------------- 配置与日历 ----------------

fn load_config(path: &PathBuf) -> Config {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Config>(&s).ok())
        .unwrap_or_default()
        .normalized()
}

fn save_config(path: &PathBuf, cfg: &Config) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // 先写临时文件再改名，避免写到一半断电导致配置损坏
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// 节假日按规则自动计算（engine::holidays），每年自动生效，不需要联网。
/// 规则之外的临时调整依次叠加：程序内置的 calendar/overrides.json，
/// 以及配置目录下用户自己放的 calendar.json（格式相同，可选）。
fn load_calendar(dir: &std::path::Path) -> (Calendar, Overrides) {
    let mut user = Overrides::default();
    if let Ok(s) = std::fs::read_to_string(dir.join("calendar.json")) {
        match serde_json::from_str::<Overrides>(&s) {
            Ok(mut o) => {
                // 旧文件可能还留有已移除市场的覆盖，载入时直接清掉。
                o.closed.retain(|g, _| CAL_GROUPS.contains(&g.as_str()));
                o.early_close.retain(|g, _| CAL_GROUPS.contains(&g.as_str()));
                o.normal.retain(|g, _| CAL_GROUPS.contains(&g.as_str()));
                user = o;
            }
            Err(e) => eprintln!("calendar.json 格式错误，已忽略：{e}"),
        }
    }
    (rebuild_calendar(&user), user)
}

/// 内置临时调整 + 用户覆盖 → 实际日历。
fn rebuild_calendar(user: &Overrides) -> Calendar {
    let mut list: Vec<Overrides> = Vec::new();
    match serde_json::from_str::<Overrides>(include_str!("../calendar/overrides.json")) {
        Ok(o) => list.push(o),
        Err(e) => eprintln!("内置节假日覆盖文件格式错误：{e}"),
    }
    list.push(user.clone());
    engine::holidays::build(&list)
}

fn save_calendar_overrides(path: &std::path::Path, overrides: &Overrides) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(overrides).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

// ---------------- 财经日历 ----------------

const NEWS_URL: &str = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
/// 成功后多久再更新一次。数据方限制访问频率，1 小时足够跟上改期和新增。
const NEWS_REFRESH: StdDuration = StdDuration::from_secs(60 * 60);
/// 失败后多久重试
const NEWS_RETRY: StdDuration = StdDuration::from_secs(15 * 60);
const NEWS_MAX_BYTES: u64 = 2 * 1024 * 1024;

fn news_cache(shared: &Shared) -> PathBuf {
    shared.cfg_path.with_file_name("news.json")
}

/// 下载周数据。先按环境变量里的代理连，失败再直连。
fn download_news() -> Result<String, String> {
    use std::io::Read;
    let get = |agent: ureq::Agent| -> Result<String, String> {
        let resp = agent
            .get(NEWS_URL)
            .set("User-Agent", concat!("TradeClock/", env!("CARGO_PKG_VERSION")))
            .call()
            .map_err(|e| match e {
                ureq::Error::Status(429, _) => "数据源限制访问频率，稍后自动重试".to_string(),
                ureq::Error::Status(c, _) => format!("数据源返回错误 {c}"),
                ureq::Error::Transport(t) => format!("网络连接失败：{t}"),
            })?;
        let mut body = String::new();
        resp.into_reader().take(NEWS_MAX_BYTES).read_to_string(&mut body).map_err(|e| e.to_string())?;
        Ok(body)
    };
    let timeout = StdDuration::from_secs(15);
    let with_proxy = ureq::AgentBuilder::new().timeout(timeout).try_proxy_from_env(true).build();
    get(with_proxy).or_else(|e| {
        let direct = ureq::AgentBuilder::new().timeout(timeout).build();
        get(direct).map_err(|_| e)
    })
}

/// 下载、解析并保存。成功返回条数。
fn refresh_news_now(app: &AppHandle, shared: &Shared) -> Result<usize, String> {
    let res = download_news().and_then(|body| {
        let events = news::parse(&body)?;
        if events.is_empty() {
            return Err("数据为空".into());
        }
        let _ = std::fs::write(news_cache(shared), &body);
        Ok(events)
    });
    let out = match res {
        Ok(events) => {
            let n = events.len();
            *shared.news.lock().unwrap() = events;
            *shared.news_state.lock().unwrap() = NewsState { updated: Some(Utc::now()), error: None };
            Ok(n)
        }
        Err(e) => {
            shared.news_state.lock().unwrap().error = Some(e.clone());
            Err(e)
        }
    };
    shared.poke();
    let _ = app.emit("news-changed", ());
    out
}

fn news_worker(app: AppHandle, shared: Arc<Shared>) {
    // 启动时先读缓存，离线也能用；缓存的修改时间就是上次更新时间
    let cache = news_cache(&shared);
    if let Ok(body) = std::fs::read_to_string(&cache) {
        if let Ok(ev) = news::parse(&body) {
            *shared.news.lock().unwrap() = ev;
            let mtime = std::fs::metadata(&cache).and_then(|m| m.modified()).ok().map(DateTime::<Utc>::from);
            shared.news_state.lock().unwrap().updated = mtime;
            shared.poke();
        }
    }
    loop {
        let enabled = shared.cfg.lock().unwrap().news_enabled;
        let age = shared.news_state.lock().unwrap().updated.map(|t| Utc::now() - t);
        let fresh = age.is_some_and(|a| a.to_std().is_ok_and(|a| a < NEWS_REFRESH));
        let wait = if !enabled || fresh {
            NEWS_RETRY.min(NEWS_REFRESH)
        } else if refresh_news_now(&app, &shared).is_ok() {
            NEWS_REFRESH
        } else {
            NEWS_RETRY
        };
        std::thread::sleep(wait);
    }
}

#[derive(Serialize)]
struct NewsInfo {
    state: NewsState,
    /// 按当前设置筛选后、今天起往后的数据
    events: Vec<NewsEvent>,
    /// 本周文件里出现的全部币种，供设置页选择
    currencies: Vec<String>,
}

#[tauri::command]
fn get_news(s: Ctx) -> NewsInfo {
    let (cfg, _, ev) = s.snapshot();
    let since = Utc::now() - Duration::hours(12);
    let events = news::select(&ev, &cfg.news_currencies, &cfg.news_impacts)
        .into_iter()
        .filter(|e| e.at >= since)
        .cloned()
        .collect();
    let mut currencies: Vec<String> = ev.iter().map(|e| e.country.clone()).collect();
    currencies.sort();
    currencies.dedup();
    NewsInfo { state: s.news_state.lock().unwrap().clone(), events, currencies }
}

/// 手动更新。放到后台线程执行，避免卡住界面。
#[tauri::command]
async fn refresh_news(app: AppHandle) -> Result<usize, String> {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || refresh_news_now(&app, &shared))
        .await
        .unwrap_or_else(|e| Err(e.to_string()))
}

// ---------------- 前端命令 ----------------

#[derive(Serialize)]
struct Status {
    now: DateTime<Utc>,
    next: Option<Alert>,
    paused_until: Option<DateTime<Utc>>,
    open: bool,
    calendar_version: String,
    hotkey: Option<String>,
    hotkey_error: Option<String>,
}

#[tauri::command]
fn get_config(s: Ctx) -> Config {
    s.cfg.lock().unwrap().clone()
}

/// 重新注册全局快捷键。返回错误文本（None 表示成功或已关闭）。
fn sync_hotkey(app: &AppHandle, cfg: &Config) -> Option<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let hotkey = cfg.hotkey.as_deref()?;
    match gs.register(hotkey) {
        Ok(()) => None,
        Err(e) => Some(format!("快捷键 {hotkey} 注册失败，可能已被其他程序占用：{e}")),
    }
}

fn apply_config(app: &AppHandle, s: &Shared, cfg: Config) -> Result<Config, String> {
    let cfg = cfg.normalized();
    save_config(&s.cfg_path, &cfg)?;
    *s.cfg.lock().unwrap() = cfg.clone();
    *s.hotkey_error.lock().unwrap() = sync_hotkey(app, &cfg);
    s.poke();
    let _ = app.emit("config-changed", &cfg);
    sync_bar(app, &cfg);
    refresh_tray(app, s);
    Ok(cfg)
}

#[tauri::command]
fn set_config(s: Ctx, app: AppHandle, cfg: Config) -> Result<Config, String> {
    apply_config(&app, &s, cfg)
}

/// 保存用户上传的提示音。前端传原始字节，先校验能否解码再写入 sounds/ 目录。
#[tauri::command]
fn upload_sound(s: Ctx, app: AppHandle, name: String, bytes: Vec<u8>) -> Result<Config, String> {
    if bytes.len() > audio::MAX_UPLOAD_BYTES {
        return Err("文件太大，请选择 5 MB 以内的音频".into());
    }
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let file = format!("custom.{ext}");
    if !is_safe_sound_name(&file) {
        return Err("只支持 WAV、MP3、OGG、FLAC 格式".into());
    }
    audio::validate(&bytes)?;
    let dir = sound_dir(&s);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // 删掉旧的自定义音频（可能是别的扩展名）
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            if e.file_name().to_str().is_some_and(is_safe_sound_name) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    std::fs::write(dir.join(&file), &bytes).map_err(|e| e.to_string())?;

    let mut cfg = s.cfg.lock().unwrap().clone();
    cfg.sound_file = Some(file);
    // 只保留文件名用于显示，去掉路径，限制长度
    let display: String = std::path::Path::new(&name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("自定义提示音")
        .chars()
        .take(60)
        .collect();
    cfg.sound_name = Some(display);
    cfg.sound_mode = SoundMode::Custom;
    set_config(s, app, cfg)
}

/// 试听：用当前设置（或指定的方式）播放一次。
#[tauri::command]
fn test_sound(s: Ctx, mode: Option<SoundMode>) {
    let cfg = s.cfg.lock().unwrap().clone();
    let mode = mode.unwrap_or(cfg.sound_mode);
    play_sound(&s, &cfg, mode, "美股开盘，15 分钟收盘".into());
}

#[tauri::command]
fn get_status(s: Ctx) -> Status {
    let now = Utc::now();
    let (cfg, cal, ev) = s.snapshot();
    let p = Planner::with_news(&cfg, &cal, &ev, now);
    Status {
        now,
        // 提前响过但还没到收盘时刻的提醒继续显示，倒计时不提前跳到下一个
        next: s.last_alert.lock().unwrap().clone().filter(|a| a.at > now).or_else(|| p.next_one(now)),
        paused_until: *s.paused_until.lock().unwrap(),
        open: p.is_open(now),
        calendar_version: cal.version,
        hotkey: cfg.hotkey.clone(),
        hotkey_error: s.hotkey_error.lock().unwrap().clone(),
    }
}

#[tauri::command]
fn get_upcoming(s: Ctx, n: usize) -> Vec<Alert> {
    let now = Utc::now();
    let (cfg, cal, ev) = s.snapshot();
    Planner::with_news(&cfg, &cal, &ev, now).upcoming(now, n.min(50))
}

#[derive(Serialize)]
struct ContractInfo {
    id: ContractId,
    name: &'static str,
    root: &'static str,
    enabled: bool,
    roll_override: Option<NaiveDate>,
    current_code: String,
    next_code: String,
    standard_roll_date: NaiveDate,
    roll_date: NaiveDate,
    expiry_date: NaiveDate,
    roll_at: DateTime<Utc>,
    standard_roll_at: DateTime<Utc>,
    /// 未来约 13 个月的换月/到期事件，前端日历直接按日期分组
    events: Vec<contracts::ContractEvent>,
}

#[tauri::command]
fn get_contracts(s: Ctx) -> Vec<ContractInfo> {
    let now = Utc::now();
    let cfg = s.cfg.lock().unwrap().clone();
    cfg.contracts
        .iter()
        .filter_map(|c| {
            let meta = c.id.meta();
            let info = contracts::next_roll(c.id, now, c.roll_override)?;
            Some(ContractInfo {
                id: c.id,
                name: meta.name,
                root: meta.root,
                enabled: c.enabled,
                roll_override: c.roll_override,
                current_code: info.current_code,
                next_code: info.next_code,
                standard_roll_date: info.standard_roll_date,
                roll_date: info.roll_date,
                expiry_date: info.expiry_date,
                roll_at: info.roll_at,
                standard_roll_at: info.standard_roll_at,
                events: contracts::events(c.id, now, c.roll_override),
            })
        })
        .collect()
}

#[tauri::command]
fn get_today(s: Ctx) -> today::Today {
    let (cfg, cal, ev) = s.snapshot();
    today::build(&cfg, &cal, &ev, Utc::now())
}

// ---------------- 节假日日历 ----------------

const CAL_GROUPS: [&str; 1] = ["cme"];

#[derive(Serialize)]
struct CalEntry {
    date: NaiveDate,
    group: String,
    kind: &'static str,
    time: Option<String>,
}

#[derive(Serialize)]
struct CalOverride {
    date: NaiveDate,
    group: String,
    kind: &'static str,
    time: Option<String>,
}

#[derive(Serialize)]
struct CalendarInfo {
    version: String,
    entries: Vec<CalEntry>,
    /// 用户自己添加或取消的日期，用于界面上的“我的覆盖”
    overrides: Vec<CalOverride>,
}

fn has_overrides(o: &Overrides) -> bool {
    o.closed.values().any(|v| !v.is_empty())
        || o.early_close.values().any(|v| !v.is_empty())
        || o.normal.values().any(|v| !v.is_empty())
}

fn remove_override_date(o: &mut Overrides, group: &str, date: NaiveDate) {
    if let Some(v) = o.closed.get_mut(group) {
        v.retain(|d| *d != date);
    }
    if let Some(v) = o.early_close.get_mut(group) {
        v.retain(|e| e.date != date);
    }
    if let Some(v) = o.normal.get_mut(group) {
        v.retain(|d| *d != date);
    }
}

/// 解析前端传来的 `YYYY-MM`，返回该月第一天和下月第一天。
fn month_range(month: &str) -> Result<(NaiveDate, NaiveDate), String> {
    let (y, m) = month.split_once('-').ok_or("月份格式应为 YYYY-MM")?;
    let y: i32 = y.parse().map_err(|_| "月份格式应为 YYYY-MM".to_string())?;
    let m: u32 = m.parse().map_err(|_| "月份格式应为 YYYY-MM".to_string())?;
    if !(1..=12).contains(&m) {
        return Err("月份格式应为 YYYY-MM".into());
    }
    let start = NaiveDate::from_ymd_opt(y, m, 1).ok_or("月份格式应为 YYYY-MM")?;
    let end = if m == 12 {
        NaiveDate::from_ymd_opt(y + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(y, m + 1, 1)
    }
    .ok_or("月份超出范围")?;
    Ok((start, end))
}

fn calendar_info(s: &Shared, month: &str) -> Result<CalendarInfo, String> {
    let cal = s.cal.lock().unwrap().clone();
    // 条目只展示基础规则；用户覆盖单独返回，前端用它覆盖规则。
    // s.cal 已叠加用户覆盖，不能直接拿来算“规则”。
    let base = rebuild_calendar(&Overrides::default());
    let user = s.cal_overrides.lock().unwrap().clone();
    let (start, end) = month_range(month)?;

    let mut entries = Vec::new();
    for group in CAL_GROUPS {
        let mut d = start;
        while d < end {
            if base.closed.get(group).is_some_and(|v| v.contains(&d)) {
                entries.push(CalEntry { date: d, group: group.into(), kind: "closed", time: None });
            } else if let Some(t) = base
                .early_close
                .get(group)
                .and_then(|v| v.iter().find(|e| e.date == d))
                .map(|e| e.time)
            {
                entries.push(CalEntry {
                    date: d,
                    group: group.into(),
                    kind: "early_close",
                    time: Some(t.format("%H:%M").to_string()),
                });
            }
            d += Duration::days(1);
        }
    }
    entries.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.group.cmp(&b.group)));

    let mut overrides = Vec::new();
    for (group, dates) in &user.closed {
        if !CAL_GROUPS.contains(&group.as_str()) {
            continue;
        }
        for date in dates {
            if *date < start || *date >= end {
                continue;
            }
            overrides.push(CalOverride { date: *date, group: group.clone(), kind: "closed", time: None });
        }
    }
    for (group, list) in &user.early_close {
        if !CAL_GROUPS.contains(&group.as_str()) {
            continue;
        }
        for e in list {
            if e.date < start || e.date >= end {
                continue;
            }
            overrides.push(CalOverride {
                date: e.date,
                group: group.clone(),
                kind: "early_close",
                time: Some(e.time.format("%H:%M").to_string()),
            });
        }
    }
    for (group, dates) in &user.normal {
        if !CAL_GROUPS.contains(&group.as_str()) {
            continue;
        }
        for date in dates {
            if *date < start || *date >= end {
                continue;
            }
            overrides.push(CalOverride { date: *date, group: group.clone(), kind: "normal", time: None });
        }
    }
    overrides.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.group.cmp(&b.group)));

    Ok(CalendarInfo { version: cal.version, entries, overrides })
}

#[tauri::command]
fn get_calendar(s: Ctx, month: String) -> Result<CalendarInfo, String> {
    calendar_info(s.inner().as_ref(), &month)
}

#[tauri::command]
fn add_calendar_override(
    s: Ctx,
    app: AppHandle,
    group: String,
    date: String,
    kind: String,
    time: Option<String>,
) -> Result<CalendarInfo, String> {
    if !CAL_GROUPS.contains(&group.as_str()) {
        return Err("未知市场".into());
    }
    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "日期格式应为 YYYY-MM-DD".to_string())?;
    if !matches!(kind.as_str(), "closed" | "early_close" | "normal") {
        return Err("未知的日历类型".into());
    }
    let early_time = if kind == "early_close" {
        let raw = time.as_deref().unwrap_or("12:00");
        Some(
            NaiveTime::parse_from_str(raw, "%H:%M")
                .or_else(|_| NaiveTime::parse_from_str(raw, "%H:%M:%S"))
                .map_err(|_| "时间格式应为 HH:MM".to_string())?,
        )
    } else {
        None
    };

    let mut ov = s.cal_overrides.lock().unwrap().clone();
    remove_override_date(&mut ov, &group, date);
    match kind.as_str() {
        "closed" => ov.closed.entry(group.clone()).or_default().push(date),
        "early_close" => ov.early_close.entry(group.clone()).or_default().push(EarlyClose {
            date,
            time: early_time.expect("提前收盘已校验时间"),
        }),
        "normal" => ov.normal.entry(group.clone()).or_default().push(date),
        _ => unreachable!(),
    }
    ov.version = if has_overrides(&ov) { "用户覆盖".into() } else { String::new() };
    save_calendar_overrides(&s.cal_path, &ov)?;
    *s.cal_overrides.lock().unwrap() = ov.clone();
    *s.cal.lock().unwrap() = rebuild_calendar(&ov);
    s.poke();
    let _ = app.emit("calendar-changed", ());
    calendar_info(s.inner().as_ref(), &date.format("%Y-%m").to_string())
}

#[tauri::command]
fn remove_calendar_override(s: Ctx, app: AppHandle, group: String, date: String) -> Result<CalendarInfo, String> {
    if !CAL_GROUPS.contains(&group.as_str()) {
        return Err("未知市场".into());
    }
    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "日期格式应为 YYYY-MM-DD".to_string())?;
    let mut ov = s.cal_overrides.lock().unwrap().clone();
    remove_override_date(&mut ov, &group, date);
    ov.version = if has_overrides(&ov) { "用户覆盖".into() } else { String::new() };
    save_calendar_overrides(&s.cal_path, &ov)?;
    *s.cal_overrides.lock().unwrap() = ov.clone();
    *s.cal.lock().unwrap() = rebuild_calendar(&ov);
    s.poke();
    let _ = app.emit("calendar-changed", ());
    calendar_info(s.inner().as_ref(), &date.format("%Y-%m").to_string())
}

#[derive(Serialize)]
struct KeyInfo {
    #[serde(flatten)]
    key: engine::keys::KeyPoint,
    /// 下一次发生时刻，前端换算成北京时间显示
    next: DateTime<Utc>,
}

#[tauri::command]
fn list_keys() -> Vec<KeyInfo> {
    let now = Utc::now();
    engine::keys::all().into_iter().map(|k| KeyInfo { next: k.next_after(now), key: k }).collect()
}

#[tauri::command]
fn pause(s: Ctx, app: AppHandle, minutes: i64) {
    pause_until(&app, &s, Utc::now() + Duration::minutes(minutes.clamp(1, 24 * 60)));
}

#[tauri::command]
fn pause_today(s: Ctx, app: AppHandle) {
    pause_today_until(&app, &s);
}

#[tauri::command]
fn resume(s: Ctx, app: AppHandle) {
    resume_now(&app, &s);
}

#[tauri::command]
fn current_alert(s: Ctx) -> Option<Alert> {
    s.last_alert.lock().unwrap().clone()
}

// ---------------- 窗口 ----------------

/// 主窗口位置是否还落在某个显示器内。拔掉副屏后旧位置可能跑到屏幕外。
fn main_pos_visible(app: &AppHandle, (x, y): (f64, f64), (w, h): (f64, f64)) -> bool {
    app.available_monitors().unwrap_or_default().iter().any(|m| {
        let sf = m.scale_factor();
        let p = m.position().to_logical::<f64>(sf);
        let s = m.size().to_logical::<f64>(sf);
        // 至少保留 80px 宽度和标题栏，避免窗口只剩一条边
        x + w > p.x + 80.0 && x < p.x + s.width - 80.0 && y + h > p.y + 40.0 && y < p.y + s.height - 40.0
    })
}

fn open_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    // 恢复上次的窗口大小和位置；没有记录或已经不在屏幕内时回到默认居中
    let (saved_pos, saved_size) = app
        .try_state::<Arc<Shared>>()
        .map(|s| {
            let cfg = s.cfg.lock().unwrap();
            (cfg.window_pos, cfg.window_size)
        })
        .unwrap_or((None, None));
    let (w, h) = saved_size
        .filter(|(w, h)| w.is_finite() && h.is_finite())
        .map(|(w, h)| (w.clamp(760.0, 10000.0), h.clamp(520.0, 10000.0)))
        .unwrap_or((880.0, 600.0));
    // 关闭即销毁（不是隐藏），释放 WebView 内存。
    // 先隐藏创建，等前端画完第一帧后调用 window_ready 再显示，避免白屏。
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("TradeClock")
        .inner_size(w, h)
        .min_inner_size(760.0, 520.0)
        .visible(false);
    builder = match saved_pos.filter(|&p| main_pos_visible(app, p, (w, h))) {
        Some((x, y)) => builder.position(x, y),
        None => builder.center(),
    };
    let built = builder.build();
    // 兜底：前端 3 秒内没报到（例如脚本出错），也把窗口显示出来，方便看到错误
    if built.is_ok() {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(StdDuration::from_secs(3));
            if let Some(w) = app.get_webview_window("main") {
                if !w.is_visible().unwrap_or(true) {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
    }
}

/// 前端第一帧渲染完成后调用，显示窗口。
#[tauri::command]
fn window_ready(window: tauri::WebviewWindow) {
    if window.label() == "main" {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ---------------- 悬浮倒计时条 ----------------

const BAR_W: f64 = 236.0;
const BAR_H: f64 = 30.0;

/// 位置是否落在某个显示器内（拔掉副屏后旧位置可能跑到屏幕外）
fn bar_pos_visible(app: &AppHandle, (x, y): (f64, f64)) -> bool {
    app.available_monitors().unwrap_or_default().iter().any(|m| {
        let sf = m.scale_factor();
        let p = m.position().to_logical::<f64>(sf);
        let s = m.size().to_logical::<f64>(sf);
        x >= p.x - BAR_W / 2.0 && x <= p.x + s.width - BAR_W / 2.0 && y >= p.y && y <= p.y + s.height - BAR_H
    })
}

/// 按配置打开或关闭倒计时条。关闭即销毁窗口，不占内存。
fn sync_bar(app: &AppHandle, cfg: &Config) {
    let existing = app.get_webview_window("bar");
    if !cfg.bar_enabled {
        if let Some(w) = existing {
            let _ = w.close();
        }
        return;
    }
    if existing.is_some() {
        return;
    }
    let (x, y) = match cfg.bar_pos.filter(|&p| bar_pos_visible(app, p)) {
        Some(p) => p,
        None => match app.primary_monitor() {
            Ok(Some(m)) => {
                let sf = m.scale_factor();
                let size = m.size().to_logical::<f64>(sf);
                (size.width - BAR_W - 16.0, 12.0)
            }
            _ => (100.0, 12.0),
        },
    };
    let _ = WebviewWindowBuilder::new(app, "bar", WebviewUrl::App("bar.html".into()))
        .title("TradeClock 倒计时")
        .inner_size(BAR_W, BAR_H)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .shadow(true)
        .build();
}

/// 拖动倒计时条后保存位置（前端停止拖动后调用一次）
#[tauri::command]
fn save_bar_pos(s: Ctx, app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    if !(x.is_finite() && y.is_finite()) {
        return Err("位置无效".into());
    }
    let saved = {
        let mut cfg = s.cfg.lock().unwrap();
        cfg.bar_pos = Some((x.round(), y.round()));
        save_config(&s.cfg_path, &cfg)?;
        cfg.clone()
    };
    // 前端 App 缓存的 cfg 也要更新，否则下一次保存设置会把旧位置写回去
    let _ = app.emit("config-changed", &saved);
    Ok(())
}

/// 主窗口移动/缩放后保存（逻辑像素）。前端防抖后调用一次。
#[tauri::command]
fn save_window_state(s: Ctx, app: AppHandle, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if ![x, y, width, height].iter().all(|v| v.is_finite()) {
        return Err("窗口位置或尺寸无效".into());
    }
    let saved = {
        let mut cfg = s.cfg.lock().unwrap();
        cfg.window_pos = Some((x.round(), y.round()));
        cfg.window_size = Some((width.round().clamp(760.0, 10000.0), height.round().clamp(520.0, 10000.0)));
        save_config(&s.cfg_path, &cfg)?;
        cfg.clone()
    };
    // 让主窗口的 Config 缓存同步窗口字段，避免下一次保存设置时覆盖
    let _ = app.emit("config-changed", &saved);
    Ok(())
}

// ---------------- 备份与诊断 ----------------

#[derive(Serialize)]
struct BackupFile {
    format: &'static str,
    version: u32,
    config: Config,
    calendar: Overrides,
}

#[derive(Serialize)]
struct Diagnostics {
    version: &'static str,
    config_path: String,
    data_dir: String,
    calendar_version: String,
    news_updated: Option<DateTime<Utc>>,
    news_error: Option<String>,
    news_count: usize,
    news_enabled: bool,
    news_currencies: Vec<String>,
}

#[tauri::command]
fn get_diagnostics(s: Ctx) -> Diagnostics {
    let cfg = s.cfg.lock().unwrap().clone();
    let state = s.news_state.lock().unwrap().clone();
    let news_count = s.news.lock().unwrap().len();
    let calendar_version = s.cal.lock().unwrap().version.clone();
    let data_dir = s.cfg_path.parent().map(|p| p.display().to_string()).unwrap_or_default();
    Diagnostics {
        version: env!("CARGO_PKG_VERSION"),
        config_path: s.cfg_path.display().to_string(),
        data_dir,
        calendar_version,
        news_updated: state.updated,
        news_error: state.error,
        news_count,
        news_enabled: cfg.news_enabled,
        news_currencies: cfg.news_currencies,
    }
}

/// 导出配置和自定义日历覆盖。前端会再包一层 UI 偏好，形成完整备份。
#[tauri::command]
fn export_backup(s: Ctx) -> Result<String, String> {
    let backup = BackupFile {
        format: "tradeclock-backup",
        version: 1,
        config: s.cfg.lock().unwrap().clone(),
        calendar: s.cal_overrides.lock().unwrap().clone(),
    };
    serde_json::to_string_pretty(&backup).map_err(|e| format!("生成备份失败：{e}"))
}

/// 同时接受完整备份和旧版纯 Config 文件。
fn parse_backup(json: &str) -> Result<(Config, Option<Overrides>), String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("备份文件格式错误：{e}"))?;
    if let Some(config) = value.get("config") {
        let cfg = serde_json::from_value(config.clone()).map_err(|e| format!("配置字段格式错误：{e}"))?;
        let cal = value
            .get("calendar")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|e| format!("日历字段格式错误：{e}"))?;
        Ok((cfg, cal))
    } else {
        let cfg = serde_json::from_value(value).map_err(|e| format!("配置字段格式错误：{e}"))?;
        Ok((cfg, None))
    }
}

#[tauri::command]
fn import_backup(s: Ctx, app: AppHandle, json: String) -> Result<Config, String> {
    let (mut cfg, cal) = parse_backup(&json)?;

    if let Some(mut ov) = cal {
        ov.closed.retain(|g, _| CAL_GROUPS.contains(&g.as_str()));
        ov.early_close.retain(|g, _| CAL_GROUPS.contains(&g.as_str()));
        ov.normal.retain(|g, _| CAL_GROUPS.contains(&g.as_str()));
        ov.version = if has_overrides(&ov) { "用户覆盖".into() } else { String::new() };
        save_calendar_overrides(&s.cal_path, &ov)?;
        *s.cal_overrides.lock().unwrap() = ov.clone();
        *s.cal.lock().unwrap() = rebuild_calendar(&ov);
        let _ = app.emit("calendar-changed", ());
    }

    // 换机器恢复时，备份里的自定义提示音可能不存在，退回系统提示音
    let missing_sound = cfg
        .sound_file
        .as_deref()
        .is_some_and(|n| !is_safe_sound_name(n) || !sound_dir(&s).join(n).is_file());
    if missing_sound {
        cfg.sound_file = None;
        cfg.sound_name = None;
        if cfg.sound_mode == SoundMode::Custom {
            cfg.sound_mode = SoundMode::System;
        }
        for m in [&mut cfg.sound_key, &mut cfg.sound_news] {
            if *m == Some(SoundMode::Custom) {
                *m = None;
            }
        }
    }

    apply_config(&app, &s, cfg)
}

#[tauri::command]
fn reset_config(s: Ctx, app: AppHandle) -> Result<Config, String> {
    apply_config(&app, &s, Config::default())
}

#[tauri::command]
fn open_data_dir(s: Ctx) -> Result<(), String> {
    let dir = s.cfg_path.parent().ok_or("找不到数据目录")?.to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开数据目录失败：{e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开数据目录失败：{e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开数据目录失败：{e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    open_main(&app);
}

fn toggle_bar(app: &AppHandle) {
    let s = app.state::<Arc<Shared>>();
    let mut cfg = s.cfg.lock().unwrap().clone();
    cfg.bar_enabled = !cfg.bar_enabled;
    let _ = set_config(s, app.clone(), cfg);
}

fn show_toast(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("toast") {
        let _ = w.close();
    }
    let (w, h, margin_x, margin_y) = (340.0, 132.0, 16.0, 60.0);
    let (x, y) = match app.primary_monitor() {
        Ok(Some(m)) => {
            let sf = m.scale_factor();
            let size = m.size().to_logical::<f64>(sf);
            (size.width - w - margin_x, size.height - h - margin_y)
        }
        _ => (100.0, 100.0),
    };
    let _ = WebviewWindowBuilder::new(app, "toast", WebviewUrl::App("toast.html".into()))
        .title("TradeClock 提醒")
        .inner_size(w, h)
        .position(x, y)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .build();
}

// ---------------- 提醒触发 ----------------

fn hm_bj(t: DateTime<Utc>) -> String {
    t.with_timezone(&Shanghai).format("%H:%M").to_string()
}

fn alert_title(a: &Alert) -> String {
    let bars = a
        .bars
        .iter()
        .map(|p| if p % 60 == 0 { format!("{}h", p / 60) } else { format!("{p}m") })
        .collect::<Vec<_>>()
        .join(" + ");
    let mut parts: Vec<String> = a.rolls.clone();
    parts.extend(a.keys.clone());
    if !a.news.is_empty() {
        // 通知标题放不下多条数据，只写第一条和条数，完整列表在浮窗里
        let more = if a.news.len() > 1 { format!(" 等 {} 条", a.news.len()) } else { String::new() };
        parts.push(format!("{}{more}", a.news[0]));
    }
    if !bars.is_empty() {
        parts.push(format!("{bars} 收盘"));
    }
    let risk = if a.risk.is_some() { "⚠ 风险窗口 · " } else { "" };
    format!("{risk}{} {}", parts.join(" · "), hm_bj(a.at))
}

/// 语音播报的文字：先说关键时点，再说 K 线，例如“美股开盘，15 分钟收盘”。
fn voice_text(a: &Alert) -> String {
    let bars = a
        .bars
        .iter()
        .map(|p| if p % 60 == 0 { format!("{} 小时", p / 60) } else { format!("{p} 分钟") })
        .collect::<Vec<_>>()
        .join("、");
    let mut parts: Vec<String> = a.rolls.clone();
    parts.extend(a.keys.clone());
    if !a.news.is_empty() {
        // 语音里不念英文标题，只说有几条数据和多久后公布
        let lead = (a.at - a.fire_at).num_minutes();
        let when = if lead > 0 { format!("{lead} 分钟后") } else { "现在".into() };
        let high = a.news.iter().filter(|n| n.ends_with("（高）")).count();
        let level = if high > 0 { "重要" } else { "" };
        parts.push(format!("{when}公布 {} 条{level}数据", a.news.len()));
    }
    if !bars.is_empty() {
        parts.push(format!("{bars}收盘"));
    }
    if a.risk.is_some() {
        parts.push("风险窗口，谨慎开新仓".into());
    }
    parts.join("，")
}

fn sound_dir(shared: &Shared) -> PathBuf {
    shared.cfg_path.parent().map(|d| d.join("sounds")).unwrap_or_else(|| PathBuf::from("sounds"))
}

fn play_sound(shared: &Shared, cfg: &Config, mode: SoundMode, text: String) {
    let file = cfg.sound_file.as_deref().filter(|n| is_safe_sound_name(n)).map(|n| sound_dir(shared).join(n));
    shared.audio.play(audio::Job { mode, file, text, volume: cfg.volume as f32 / 100.0 });
}

fn fire(app: &AppHandle, shared: &Shared, a: &Alert) {
    *shared.last_alert.lock().unwrap() = Some(a.clone());
    let cfg = shared.cfg.lock().unwrap().clone();
    // 声音按最重要的那类事件选：财经数据 > 关键时点/换月 > K 线
    let mode = if !a.news.is_empty() {
        cfg.sound_news.unwrap_or(cfg.sound_mode)
    } else if !a.keys.is_empty() || !a.rolls.is_empty() {
        cfg.sound_key.unwrap_or(cfg.sound_mode)
    } else {
        cfg.sound_mode
    };
    play_sound(shared, &cfg, mode, voice_text(a));
    if cfg.notify {
        let body = match &a.risk {
            Some(r) => format!("风险窗口，谨慎开新仓（{r}）· {}", a.session),
            None => a.session.clone(),
        };
        let _ = app.notification().builder().title(alert_title(a)).body(body).show();
    }
    if cfg.toast {
        show_toast(app);
    }
    let _ = app.emit("alert", a);
}

/// 错过提醒的汇总：只发一条系统通知，不播放声音、不弹浮窗。
fn notify_missed(app: &AppHandle, shared: &Shared, missed: &[Alert]) {
    let Some(last) = missed.last() else { return };
    let cfg = shared.cfg.lock().unwrap().clone();
    let first = missed[0].at;
    let news = missed.iter().filter(|a| !a.news.is_empty()).count();
    let mut body = format!("{} – {} 期间，最近一条：{}", hm_bj(first), hm_bj(last.at), alert_title(last));
    if news > 0 {
        body.push_str(&format!("；其中 {news} 条是财经数据，请到“财经日历”查看"));
    }
    eprintln!("[scheduler] 错过 {} 条提醒（{}）", missed.len(), body);
    if cfg.notify {
        let _ = app
            .notification()
            .builder()
            .title(format!("TradeClock · 睡眠期间错过 {} 条提醒", missed.len()))
            .body(body)
            .show();
    }
    let _ = app.emit("missed", missed.len());
}

fn set_tooltip(app: &AppHandle, text: &str) {
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_tooltip(Some(text));
    }
}

fn scheduler(app: AppHandle, shared: Arc<Shared>) {
    let mut last_fired = Utc::now();
    // 上一轮循环的时刻。循环最多等 MAX_WAIT 就会醒，两轮间隔明显更长说明电脑睡眠过
    let mut last_tick = Utc::now();
    loop {
        let now = Utc::now();
        let slept = (now - last_tick).num_seconds() > MAX_WAIT.as_secs() as i64 + 10;
        last_tick = now;
        let (cfg, cal, ev) = shared.snapshot();
        let planner = Planner::with_news(&cfg, &cal, &ev, now);
        // 从“上次触发”往后找，这样睡眠期间错过的提醒能被发现并汇总；
        // 最多回看 12 小时（规划器只准备了前一天的交易时段数据）
        let cursor = last_fired.max(now - Duration::hours(12));
        let next = planner.next_one(cursor);
        let paused_until = *shared.paused_until.lock().unwrap();
        let paused = paused_until.is_some_and(|p| p > now);
        update_tray_state(&app, &shared, planner.is_open(now), paused);

        let tip = match (&next, paused) {
            (_, true) => format!("TradeClock · 已暂停至 {}", hm_bj(paused_until.expect("已暂停必有结束时间"))),
            (Some(a), _) if planner.is_open(now) => format!("TradeClock · 下次 {}", hm_bj(a.at)),
            (Some(a), _) => format!("TradeClock · 休市中 · 下次 {}", hm_bj(a.at)),
            (None, _) => "TradeClock · 未来 10 天无提醒".to_string(),
        };
        set_tooltip(&app, &tip);

        let wait = match &next {
            // 睡眠唤醒（或程序卡住）后错过的提醒：不逐条补响，合并成一条汇总通知
            Some(a) if (now - a.fire_at).num_seconds() > LATE_TOLERANCE_SECS => {
                // 不是睡眠造成的过期（例如刚改了提前秒数），直接跳过，不打扰
                if !slept {
                    last_fired = now - Duration::seconds(LATE_TOLERANCE_SECS);
                    continue;
                }
                let mut missed = vec![a.clone()];
                let mut cur = a.fire_at;
                while let Some(b) = planner.next_one(cur) {
                    if (now - b.fire_at).num_seconds() <= LATE_TOLERANCE_SECS || missed.len() >= 5000 {
                        break;
                    }
                    cur = b.fire_at;
                    missed.push(b);
                }
                last_fired = cur;
                if !paused {
                    notify_missed(&app, &shared, &missed);
                }
                continue;
            }
            Some(a) if a.fire_at <= now => {
                if !paused {
                    fire(&app, &shared, a);
                }
                last_fired = a.fire_at;
                continue;
            }
            Some(a) => (a.fire_at - now).to_std().unwrap_or_default().min(MAX_WAIT),
            None => MAX_WAIT,
        };

        let (m, cv) = &shared.wake;
        let g = m.lock().unwrap();
        let seen = *g;
        let _ = cv.wait_timeout_while(g, wait, |v| *v == seen).unwrap();
    }
}

// ---------------- 托盘 ----------------

fn pause_until(app: &AppHandle, s: &Shared, until: DateTime<Utc>) {
    *s.paused_until.lock().unwrap() = Some(until);
    s.poke();
    refresh_tray(app, s);
    let _ = app.emit("pause-changed", ());
}

fn resume_now(app: &AppHandle, s: &Shared) {
    *s.paused_until.lock().unwrap() = None;
    s.poke();
    refresh_tray(app, s);
    let _ = app.emit("pause-changed", ());
}

/// 暂停到北京时间下一个 00:00。
fn pause_today_until(app: &AppHandle, s: &Shared) {
    let now = Utc::now();
    let tomorrow = now.with_timezone(&Shanghai).date_naive() + Duration::days(1);
    pause_until(app, s, local_to_utc(Shanghai, tomorrow, hm(0, 0)));
}

/// 暂停到下一个开盘时刻；未来 10 天都没有开盘时返回 false。
fn pause_next_session(app: &AppHandle, s: &Shared) -> bool {
    let now = Utc::now();
    let (cfg, cal, ev) = s.snapshot();
    let Some(start) = Planner::with_news(&cfg, &cal, &ev, now).next_open_start(now) else {
        return false;
    };
    pause_until(app, s, start);
    true
}

fn toggle_pause(app: &AppHandle) {
    let s = app.state::<Arc<Shared>>();
    if s.paused(Utc::now()) {
        resume_now(app, &s);
    } else {
        pause_until(app, &s, Utc::now() + Duration::minutes(15));
    }
}

/// 生成托盘图标：实心圆 + 白色指针。颜色区分交易中 / 已暂停 / 休市。
fn tray_icon(state: TrayState) -> Image<'static> {
    const S: usize = 32;
    let (r, g, b) = match state {
        TrayState::Running => (240u8, 160u8, 32u8),
        TrayState::Paused => (158, 166, 178),
        TrayState::Closed => (92, 108, 129),
    };
    let mut px = vec![0u8; S * S * 4];
    for y in 0..S {
        for x in 0..S {
            let dx = x as f32 + 0.5 - 16.0;
            let dy = y as f32 + 0.5 - 16.0;
            let d = (dx * dx + dy * dy).sqrt();
            let edge = if d <= 14.0 { 1.0 } else if d < 15.2 { (15.2 - d) / 1.2 } else { 0.0 };
            if edge > 0.0 {
                let i = (y * S + x) * 4;
                px[i..i + 3].copy_from_slice(&[r, g, b]);
                px[i + 3] = (edge * 255.0) as u8;
            }
        }
    }
    // 指针：中心向上、向右，白色，最细也有 2px，缩到 16px 时仍能看清
    for y in 9..16 {
        for x in 15..17 {
            let i = (y * S + x) * 4;
            px[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
        }
    }
    for x in 16..23 {
        for y in 15..17 {
            let i = (y * S + x) * 4;
            px[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
        }
    }
    for y in 14..18 {
        for x in 14..18 {
            let i = (y * S + x) * 4;
            px[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
        }
    }
    Image::new_owned(px, S as u32, S as u32)
}

fn update_tray_state(app: &AppHandle, shared: &Shared, open: bool, paused: bool) {
    let state = if paused {
        TrayState::Paused
    } else if open {
        TrayState::Running
    } else {
        TrayState::Closed
    };
    {
        let mut cur = shared.tray_state.lock().unwrap();
        if *cur == Some(state) {
            return;
        }
        *cur = Some(state);
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(tray_icon(state)));
    }
    if let Some(item) = shared.tray_state_item.lock().unwrap().as_ref() {
        let text = match state {
            TrayState::Running => "状态：交易中",
            TrayState::Paused => "状态：已暂停",
            TrayState::Closed => "状态：休市",
        };
        let _ = item.set_text(text);
    }
}

/// 从当前配置重算交易状态并刷新托盘（暂停、改配置、改日历后调用）。
fn refresh_tray(app: &AppHandle, shared: &Shared) {
    let now = Utc::now();
    let (cfg, cal, ev) = shared.snapshot();
    let planner = Planner::with_news(&cfg, &cal, &ev, now);
    update_tray_state(app, shared, planner.is_open(now), shared.paused(now));
    // 只有单选一个周期时才打勾；多选时让四项都不勾，表示“自定义”
    let single = (cfg.periods.len() == 1).then(|| cfg.periods[0]);
    for (p, item) in shared.tray_periods.lock().unwrap().iter() {
        let _ = item.set_checked(single == Some(*p));
    }
}

fn set_period(app: &AppHandle, shared: &Shared, p: u32) {
    let mut cfg = shared.cfg.lock().unwrap().clone();
    cfg.periods = vec![p];
    let _ = apply_config(app, shared, cfg);
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let state = MenuItem::with_id(app, "state", "状态：--", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "打开 TradeClock", true, None::<&str>)?;
    let p15 = MenuItem::with_id(app, "p15", "暂停 15 分钟", true, None::<&str>)?;
    let p30 = MenuItem::with_id(app, "p30", "暂停 30 分钟", true, None::<&str>)?;
    let p60 = MenuItem::with_id(app, "p60", "暂停 1 小时", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "暂停到下个时段", true, None::<&str>)?;
    let today = MenuItem::with_id(app, "today", "今天不再提醒", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "恢复提醒", true, None::<&str>)?;
    let per5 = CheckMenuItem::with_id(app, "per5", "只提醒 5 分钟 K 线", true, false, None::<&str>)?;
    let per15 = CheckMenuItem::with_id(app, "per15", "只提醒 15 分钟 K 线", true, false, None::<&str>)?;
    let per30 = CheckMenuItem::with_id(app, "per30", "只提醒 30 分钟 K 线", true, false, None::<&str>)?;
    let per60 = CheckMenuItem::with_id(app, "per60", "只提醒 1 小时 K 线", true, false, None::<&str>)?;
    let periods = Submenu::with_items(app, "快速周期", true, &[&per5, &per15, &per30, &per60])?;
    let test = MenuItem::with_id(app, "test", "测试一次提醒", true, None::<&str>)?;
    let bar = MenuItem::with_id(app, "bar", "显示 / 隐藏倒计时条", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let (s0, s1, s2, s3, s4) = (
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
    );
    let items: [&dyn IsMenuItem<tauri::Wry>; 17] = [
        &state, &s0, &open, &s1, &p15, &p30, &p60, &next, &today, &resume, &s2, &periods, &s3, &bar, &test, &s4, &quit,
    ];
    let menu = Menu::with_items(app, &items)?;
    let _ = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("已配置图标").clone())
        .tooltip("TradeClock")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| {
            let s = app.state::<Arc<Shared>>();
            match e.id.as_ref() {
                "open" => open_main(app),
                "p15" => pause_until(app, &s, Utc::now() + Duration::minutes(15)),
                "p30" => pause_until(app, &s, Utc::now() + Duration::minutes(30)),
                "p60" => pause_until(app, &s, Utc::now() + Duration::minutes(60)),
                "next" => {
                    pause_next_session(app, &s);
                }
                "today" => pause_today_until(app, &s),
                "resume" => resume_now(app, &s),
                "per5" => set_period(app, &s, 5),
                "per15" => set_period(app, &s, 15),
                "per30" => set_period(app, &s, 30),
                "per60" => set_period(app, &s, 60),
                "test" => {
                    let now = Utc::now();
                    let (cfg, cal, ev) = s.snapshot();
                    if let Some(a) = Planner::with_news(&cfg, &cal, &ev, now).next_one(now) {
                        fire(app, &s, &a);
                    }
                }
                "bar" => toggle_bar(app),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                open_main(tray.app_handle());
            }
        })
        .build(app)?;
    let shared = app.state::<Arc<Shared>>();
    *shared.tray_state_item.lock().unwrap() = Some(state);
    *shared.tray_periods.lock().unwrap() = vec![(5, per5), (15, per15), (30, per30), (60, per60)];
    Ok(())
}

// ---------------- 入口 ----------------

pub fn run() {
    tauri::Builder::default()
        // 单实例：再次启动时只打开已有程序的窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| open_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_pause(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            get_status,
            get_upcoming,
            get_contracts,
            get_today,
            list_keys,
            pause,
            pause_today,
            resume,
            get_calendar,
            add_calendar_override,
            remove_calendar_override,
            current_alert,
            window_ready,
            upload_sound,
            test_sound,
            get_news,
            refresh_news,
            save_bar_pos,
            save_window_state,
            get_diagnostics,
            export_backup,
            import_backup,
            reset_config,
            open_data_dir,
            open_settings
        ])
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let cfg_path = dir.join("config.json");
            let cal_path = dir.join("calendar.json");
            let (cal, cal_overrides) = load_calendar(&dir);
            let shared = Arc::new(Shared {
                cfg: Mutex::new(load_config(&cfg_path)),
                cal: Mutex::new(cal),
                cal_overrides: Mutex::new(cal_overrides),
                cal_path,
                paused_until: Mutex::new(None),
                last_alert: Mutex::new(None),
                wake: (Mutex::new(0), Condvar::new()),
                cfg_path,
                audio: audio::Audio::start(),
                news: Mutex::new(Vec::new()),
                news_state: Mutex::new(NewsState::default()),
                hotkey_error: Mutex::new(None),
                tray_state: Mutex::new(None),
                tray_state_item: Mutex::new(None),
                tray_periods: Mutex::new(Vec::new()),
            });
            app.manage(shared.clone());
            sync_bar(app.handle(), &shared.cfg.lock().unwrap().clone());
            build_tray(app)?;
            // 快捷键被其他程序占用时不影响启动，只在设置页提示
            let startup_cfg = shared.cfg.lock().unwrap().clone();
            *shared.hotkey_error.lock().unwrap() = sync_hotkey(app.handle(), &startup_cfg);
            refresh_tray(app.handle(), &shared);

            let (h1, s1) = (app.handle().clone(), shared.clone());
            std::thread::Builder::new().name("news".into()).spawn(move || news_worker(h1, s1))?;
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("scheduler".into())
                .spawn(move || scheduler(handle, shared))?;

            // 开机自启时带 --minimized，只进托盘；手动启动则打开主窗口
            if !std::env::args().any(|a| a == "--minimized") {
                open_main(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("TradeClock 启动失败")
        .run(|_app, event| {
            // 关闭所有窗口后继续在托盘运行，只有菜单“退出”才真正退出
            if let RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

#[cfg(test)]
mod backup_tests {
    use super::*;

    #[test]
    fn backup_roundtrip_keeps_config_and_calendar() {
        let backup = BackupFile {
            format: "tradeclock-backup",
            version: 1,
            config: Config::default(),
            calendar: Overrides::default(),
        };
        let text = serde_json::to_string(&backup).unwrap();
        let (cfg, cal) = parse_backup(&text).unwrap();
        assert_eq!(cfg, Config::default());
        assert!(cal.is_some());
    }

    #[test]
    fn plain_config_file_is_still_importable() {
        let text = serde_json::to_string(&Config::default()).unwrap();
        let (cfg, cal) = parse_backup(&text).unwrap();
        assert_eq!(cfg, Config::default());
        assert!(cal.is_none());
    }

    #[test]
    fn invalid_backup_is_rejected() {
        assert!(parse_backup("not json").is_err());
        assert!(parse_backup(r#"{"config":{"periods":"bad"}}"#).is_err());
    }
}
