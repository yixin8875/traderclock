//! 用户配置。保存为本地 JSON，缺失字段自动用默认值补齐（兼容旧版本配置文件）。

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::contracts::ContractId;
use super::keys;
use super::market::TemplateId;
use super::news::Impact;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TemplateSetting {
    pub id: TemplateId,
    pub enabled: bool,
    /// 周末是否提醒（只对 7×24 品种有意义）。
    #[serde(default)]
    pub weekend: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ContractSetting {
    pub id: ContractId,
    pub enabled: bool,
    /// 手动覆盖当前合约的换月日；None 表示按标准规则。
    #[serde(default)]
    pub roll_override: Option<NaiveDate>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KeySetting {
    pub id: String,
    pub enabled: bool,
    /// 提前多少分钟提醒，0 表示准点。
    #[serde(default)]
    pub lead_minutes: u32,
}

/// 提示音类型
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SoundMode {
    Off,
    /// Windows 自带提示音
    System,
    /// 用户上传的音频文件
    Custom,
    /// 语音播报，例如“美股开盘，15 分钟收盘”
    Voice,
    /// Windows 闹钟铃声，比普通提示音更醒目
    Alarm,
}

/// 反序列化品种列表。旧版本配置里可能还留着已移除的品种 id，
/// 这里逐条解析并丢弃未知项，避免整份配置因为一个旧字段回退默认。
fn deserialize_templates<'de, D>(d: D) -> Result<Vec<TemplateSetting>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    struct Raw {
        id: String,
        #[serde(default)]
        enabled: bool,
        #[serde(default)]
        weekend: bool,
    }
    Vec::<Raw>::deserialize(d).map(|list| {
        list.into_iter()
            .filter_map(|r| {
                TemplateId::from_id(&r.id).map(|id| TemplateSetting { id, enabled: r.enabled, weekend: r.weekend })
            })
            .collect()
    })
}

/// 合约列表同样逐条解析；未知 id 或非法日期只丢弃该项，不拖垮整份配置。
fn deserialize_contracts<'de, D>(d: D) -> Result<Vec<ContractSetting>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    struct Raw {
        id: String,
        #[serde(default)]
        enabled: bool,
        #[serde(default)]
        roll_override: Option<String>,
    }
    Vec::<Raw>::deserialize(d).map(|list| {
        list.into_iter()
            .filter_map(|r| {
                ContractId::from_id(&r.id).map(|id| ContractSetting {
                    id,
                    enabled: r.enabled,
                    roll_override: r.roll_override.and_then(|s| s.parse().ok()),
                })
            })
            .collect()
    })
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    #[serde(default, deserialize_with = "deserialize_templates")]
    pub templates: Vec<TemplateSetting>,
    #[serde(default, deserialize_with = "deserialize_contracts")]
    pub contracts: Vec<ContractSetting>,
    /// K 线周期（分钟），可多选。
    pub periods: Vec<u32>,
    /// K 线对齐时区（IANA 名称）。CME 期货默认用 America/Chicago。
    pub align_tz: String,
    /// K 线收盘前提前多少秒提醒。
    pub lead_seconds: u32,
    pub keys: Vec<KeySetting>,
    pub notify: bool,
    pub toast: bool,
    pub toast_seconds: u32,
    pub sound_mode: SoundMode,
    /// 上传的音频保存在配置目录 sounds/ 下的文件名，例如 "custom.mp3"
    pub sound_file: Option<String>,
    /// 上传时的原始文件名，只用于界面显示
    pub sound_name: Option<String>,
    /// 音量 0–100
    pub volume: u32,
    /// 财经日历（ForexFactory 官方周数据）
    pub news_enabled: bool,
    /// 关注的币种，例如 ["USD"]
    pub news_currencies: Vec<String>,
    /// 要提醒的重要程度
    pub news_impacts: Vec<Impact>,
    /// 数据发布前多少分钟提醒，0 = 准点
    pub news_lead_minutes: u32,
    /// 高重要度数据前后的风险窗口
    pub risk_enabled: bool,
    /// 公布前多少分钟进入风险窗口
    pub risk_before_minutes: u32,
    /// 公布后多少分钟离开风险窗口
    pub risk_after_minutes: u32,
    /// 高重要度数据的额外预警：公布前多少分钟再提醒一次，0 = 关闭
    pub news_prewarn_minutes: u32,
    /// K 线静音时段（北京时间，从 00:00 起的分钟数）。只静音 K 线收盘，关键时点和数据照常提醒。
    pub quiet_enabled: bool,
    pub quiet_start: u32,
    pub quiet_end: u32,
    /// 关键时点和财经数据单独的提示音；None 表示和 K 线一样
    pub sound_key: Option<SoundMode>,
    pub sound_news: Option<SoundMode>,
    /// 桌面悬浮倒计时条
    pub bar_enabled: bool,
    /// 倒计时条位置（逻辑像素，左上角）；None 表示放在主屏右上角
    pub bar_pos: Option<(f64, f64)>,
    /// 主窗口位置（逻辑像素，左上角）；None 表示居中
    pub window_pos: Option<(f64, f64)>,
    /// 主窗口大小（逻辑像素）；None 表示默认 880×600
    pub window_size: Option<(f64, f64)>,
    /// 暂停 / 恢复提醒的全局快捷键；None 表示不注册。
    #[serde(default = "default_hotkey")]
    pub hotkey: Option<String>,
}

/// 允许的快捷键。只提供固定组合，避免前端随意注册与系统冲突的按键。
pub const HOTKEYS: [&str; 3] = ["ctrl+alt+p", "ctrl+shift+p", "ctrl+alt+k"];

fn default_hotkey() -> Option<String> {
    Some(HOTKEYS[0].to_string())
}

impl Default for Config {
    fn default() -> Self {
        let on = [TemplateId::CmeEquity, TemplateId::ComexGold];
        Config {
            templates: TemplateId::ALL
                .iter()
                .map(|&id| TemplateSetting { id, enabled: on.contains(&id), weekend: false })
                .collect(),
            contracts: ContractId::ALL
                .iter()
                .map(|&id| ContractSetting { id, enabled: id != ContractId::Btc, roll_override: None })
                .collect(),
            periods: vec![15],
            align_tz: "America/Chicago".into(),
            lead_seconds: 0,
            keys: keys::all()
                .iter()
                .map(|k| KeySetting { id: k.id.into(), enabled: k.major && k.id != "us_data", lead_minutes: 0 })
                .collect(),
            notify: true,
            toast: true,
            toast_seconds: 8,
            sound_mode: SoundMode::System,
            sound_file: None,
            sound_name: None,
            volume: 80,
            news_enabled: true,
            news_currencies: vec!["USD".into()],
            news_impacts: vec![Impact::High, Impact::Medium],
            news_lead_minutes: 2,
            risk_enabled: true,
            risk_before_minutes: 5,
            risk_after_minutes: 10,
            news_prewarn_minutes: 15,
            quiet_enabled: false,
            quiet_start: 0,
            quiet_end: 7 * 60,
            sound_key: None,
            sound_news: None,
            bar_enabled: true,
            bar_pos: None,
            window_pos: None,
            window_size: None,
            hotkey: default_hotkey(),
        }
    }
}

impl Config {
    /// 补齐新版本新增的模板和关键时点，去掉无效周期。
    pub fn normalized(mut self) -> Self {
        let def = Config::default();
        for t in def.templates {
            if !self.templates.iter().any(|x| x.id == t.id) {
                self.templates.push(t);
            }
        }
        for c in def.contracts {
            if !self.contracts.iter().any(|x| x.id == c.id) {
                self.contracts.push(c);
            }
        }
        let mut seen_contracts = std::collections::HashSet::new();
        self.contracts.retain(|c| seen_contracts.insert(c.id));
        for k in def.keys {
            if !self.keys.iter().any(|x| x.id == k.id) {
                self.keys.push(k);
            }
        }
        // 只保留 CME 常用的两种对齐时区；旧配置里的平台服务器时区回到芝加哥。
        if !matches!(self.align_tz.as_str(), "America/Chicago" | "Asia/Shanghai") {
            self.align_tz = "America/Chicago".into();
        }
        self.periods.retain(|&p| (1..=1440).contains(&p));
        self.periods.sort_unstable();
        self.periods.dedup();
        self.toast_seconds = self.toast_seconds.clamp(3, 60);
        self.volume = self.volume.min(100);
        self.news_lead_minutes = self.news_lead_minutes.min(60);
        self.lead_seconds = self.lead_seconds.min(600);
        self.risk_before_minutes = self.risk_before_minutes.min(120);
        self.risk_after_minutes = self.risk_after_minutes.min(120);
        self.news_prewarn_minutes = self.news_prewarn_minutes.min(120);
        self.quiet_start %= 1440;
        self.quiet_end %= 1440;
        // 窗口位置只接受有限数值；大小限制在可用范围内，防止配置损坏后窗口不可见
        self.window_pos = self.window_pos.filter(|(x, y)| x.is_finite() && y.is_finite());
        self.window_size = self
            .window_size
            .filter(|(w, h)| w.is_finite() && h.is_finite())
            .map(|(w, h)| (w.clamp(760.0, 10000.0), h.clamp(520.0, 10000.0)));
        self.news_currencies = self
            .news_currencies
            .iter()
            .map(|c| c.trim().to_ascii_uppercase())
            .filter(|c| (2..=4).contains(&c.len()) && c.chars().all(|ch| ch.is_ascii_alphabetic()))
            .collect();
        self.news_currencies.sort();
        self.news_currencies.dedup();
        self.news_impacts.retain(|i| matches!(i, Impact::High | Impact::Medium | Impact::Low));
        self.news_impacts.dedup();
        // 只接受预设组合；None 表示用户主动关闭快捷键，保持不变。
        if self.hotkey.as_deref().is_some_and(|h| !HOTKEYS.contains(&h)) {
            self.hotkey = default_hotkey();
        }
        // 只接受我们自己保存的文件名，防止配置里写入任意路径
        if !self.sound_file.as_deref().is_some_and(is_safe_sound_name) {
            self.sound_file = None;
            if self.sound_mode == SoundMode::Custom {
                self.sound_mode = SoundMode::System;
            }
            for m in [&mut self.sound_key, &mut self.sound_news] {
                if *m == Some(SoundMode::Custom) {
                    *m = None;
                }
            }
        }
        self
    }

    /// 北京时间 `t` 是否在 K 线静音时段内。开始晚于结束表示跨午夜，例如 23:00–07:00。
    pub fn is_quiet(&self, t: chrono::DateTime<chrono::Utc>) -> bool {
        use chrono::Timelike;
        if !self.quiet_enabled || self.quiet_start == self.quiet_end {
            return false;
        }
        let l = t.with_timezone(&chrono_tz::Asia::Shanghai);
        let m = l.hour() * 60 + l.minute();
        if self.quiet_start < self.quiet_end {
            (self.quiet_start..self.quiet_end).contains(&m)
        } else {
            m >= self.quiet_start || m < self.quiet_end
        }
    }

    pub fn align_tz(&self) -> chrono_tz::Tz {
        self.align_tz.parse().unwrap_or(chrono_tz::America::Chicago)
    }
}

/// 合法的自定义提示音文件名：custom.wav / custom.mp3 / custom.ogg / custom.flac
pub fn is_safe_sound_name(n: &str) -> bool {
    matches!(n, "custom.wav" | "custom.mp3" | "custom.ogg" | "custom.flac")
}
