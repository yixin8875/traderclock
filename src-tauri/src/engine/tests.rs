//! 引擎单元测试：对应 PRD 第 10 节验收标准。运行：cd src-tauri && cargo test

use chrono::{DateTime, Duration, NaiveDate, Utc};
use chrono_tz::{America, Asia, Tz};

use super::config::{Config, ContractSetting, KeySetting, TemplateSetting};
use super::contracts::ContractId;
use super::keys;
use super::market::{template, Calendar, EarlyClose, TemplateId};
use super::schedule::{next_alerts, next_boundary};
use super::tz::{hm, is_dst, local_to_utc};

fn at(tz: Tz, y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
    local_to_utc(tz, NaiveDate::from_ymd_opt(y, mo, d).unwrap(), hm(h, mi))
}
fn bj(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
    at(Asia::Shanghai, y, mo, d, h, mi)
}
fn ct(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
    at(America::Chicago, y, mo, d, h, mi)
}
fn bj_hm(t: DateTime<Utc>) -> String {
    t.with_timezone(&Asia::Shanghai).format("%H:%M").to_string()
}

/// 只开一个模板、只有 K 线周期、不开关键时点的配置。
fn bars_only(id: TemplateId, periods: Vec<u32>, align: &str, weekend: bool) -> Config {
    let mut c = Config::default();
    c.templates = vec![TemplateSetting { id, enabled: true, weekend }];
    c.periods = periods;
    c.align_tz = align.into();
    c.keys.clear();
    c.contracts.clear();
    c
}

fn keys_only(ids: &[&str]) -> Config {
    let mut c = Config::default();
    c.periods.clear();
    c.contracts.clear();
    c.keys = ids.iter().map(|id| KeySetting { id: id.to_string(), enabled: true, lead_minutes: 0 }).collect();
    c
}

fn key_time(id: &str, after: DateTime<Utc>) -> String {
    let k = keys::all().into_iter().find(|k| k.id == id).unwrap();
    bj_hm(k.next_after(after))
}

#[test]
fn dst_gap_moves_forward() {
    // 2026-03-08 芝加哥 02:30 不存在，顺延到 03:30 CDT = 08:30 UTC
    let t = ct(2026, 3, 8, 2, 30);
    assert_eq!(t, "2026-03-08T08:30:00Z".parse::<DateTime<Utc>>().unwrap());
}

#[test]
fn cme_open_close_and_daily_halt() {
    let t = template(TemplateId::CmeEquity);
    let cal = Calendar::default();
    // 2026-10-26 周一北京时间 05:30 = 芝加哥周日 16:30，周开盘前
    assert!(!t.is_open(bj(2026, 10, 26, 5, 30), false, &cal));
    assert!(t.is_open(bj(2026, 10, 26, 6, 0), false, &cal));
    // 美国夏令时：每日休市为北京 05:00–06:00
    assert!(!t.is_open(bj(2026, 10, 27, 5, 30), false, &cal));
    assert!(t.is_open(bj(2026, 10, 27, 4, 59), false, &cal));
    // 11 月 1 日美国切冬令时后：休市变成北京 06:00–07:00
    assert!(t.is_open(bj(2026, 11, 3, 5, 30), false, &cal));
    assert!(!t.is_open(bj(2026, 11, 3, 6, 30), false, &cal));
    // 周六全天休市
    assert!(!t.is_open(bj(2026, 10, 31, 12, 0), false, &cal));
}

#[test]
fn cme_15m_full_session_count() {
    // 周日 17:00 CT – 周一 16:00 CT 共 23 小时 = 92 根 15m K 线
    let cfg = bars_only(TemplateId::CmeEquity, vec![15], "America/Chicago", false);
    let from = ct(2026, 10, 25, 16, 0);
    let list = next_alerts(&cfg, &Calendar::default(), from, 100);
    let start = ct(2026, 10, 25, 17, 0);
    let end = ct(2026, 10, 26, 16, 0);
    let inside: Vec<_> = list.iter().filter(|a| a.at > start && a.at <= end).collect();
    assert_eq!(inside.len(), 92);
    assert_eq!(list[0].at, ct(2026, 10, 25, 17, 15));
    assert_eq!(list[91].at, end);
    // 每日休市期间没有提醒，恢复后第一根是 17:15
    assert_eq!(list[92].at, ct(2026, 10, 26, 17, 15));
}

#[test]
fn crosses_beijing_midnight() {
    let cfg = bars_only(TemplateId::CmeEquity, vec![15], "America/Chicago", false);
    let list = next_alerts(&cfg, &Calendar::default(), bj(2026, 10, 27, 23, 30), 3);
    let got: Vec<_> = list.iter().map(|a| bj_hm(a.at)).collect();
    assert_eq!(got, ["23:45", "00:00", "00:15"]);
}

#[test]
fn key_points_follow_each_dst() {
    // 美股开盘：美国夏令时 21:30，11 月 1 日后 22:30
    assert_eq!(key_time("us_open", bj(2026, 10, 30, 12, 0)), "21:30");
    assert_eq!(key_time("us_open", bj(2026, 11, 2, 12, 0)), "22:30");
    // 伦敦开盘：英国夏令时 15:00，10 月 25 日后 16:00（不同步周）
    assert_eq!(key_time("london_open", bj(2026, 10, 23, 12, 0)), "15:00");
    assert_eq!(key_time("london_open", bj(2026, 10, 26, 12, 0)), "16:00");
    // 悉尼开盘：南半球 10 月进入夏令时，北京 04:00；7 月冬令时 05:00
    assert_eq!(key_time("sydney_open", bj(2026, 10, 26, 12, 0)), "04:00");
    assert_eq!(key_time("sydney_open", bj(2026, 7, 15, 12, 0)), "05:00");
    // 东京无夏令时
    assert_eq!(key_time("tokyo_open", bj(2026, 7, 15, 12, 0)), "08:00");
    // 不同步周的状态
    let t = bj(2026, 10, 27, 12, 0);
    assert!(!is_dst(chrono_tz::Europe::London, t));
    assert!(is_dst(America::New_York, t));
}

#[test]
fn key_point_only_on_weekdays() {
    // 周五 21:30 美股开盘之后，下一次是下周一
    let next = keys::all().into_iter().find(|k| k.id == "us_open").unwrap().next_after(bj(2026, 10, 30, 22, 0));
    assert_eq!(next, bj(2026, 11, 2, 22, 30));
    // CME 周开盘只在周日 17:00 CT
    let w = keys::all().into_iter().find(|k| k.id == "cme_week_open").unwrap().next_after(bj(2026, 10, 27, 0, 0));
    assert_eq!(w, ct(2026, 11, 1, 17, 0));
}

#[test]
fn weekend_switch_for_crypto() {
    let sat = bj(2026, 10, 31, 12, 0);
    let off = bars_only(TemplateId::CmeCrypto, vec![60], "America/Chicago", false);
    let first = &next_alerts(&off, &Calendar::default(), sat, 1)[0];
    // 周末关闭时，下一次是周日 17:00 CT 开盘后的第一根 1h
    assert_eq!(first.at, ct(2026, 11, 1, 18, 0));
    let on = bars_only(TemplateId::CmeCrypto, vec![60], "America/Chicago", true);
    let first = &next_alerts(&on, &Calendar::default(), sat, 1)[0];
    assert_eq!(first.at, bj(2026, 10, 31, 13, 0));
}

#[test]
fn holiday_and_early_close() {
    let cfg = bars_only(TemplateId::CmeEquity, vec![15], "America/Chicago", false);
    let mut cal = Calendar::default();
    // 交易日 10/28 休市：10/27 17:00 CT – 10/28 16:00 CT 无提醒
    cal.closed.insert("cme".into(), vec![NaiveDate::from_ymd_opt(2026, 10, 28).unwrap()]);
    let first = &next_alerts(&cfg, &cal, ct(2026, 10, 27, 16, 30), 1)[0];
    assert_eq!(first.at, ct(2026, 10, 28, 17, 15));
    // 提前收盘 12:00 CT：最后一根是 12:00，之后跳到 17:15
    let mut cal = Calendar::default();
    cal.early_close.insert("cme".into(), vec![EarlyClose { date: NaiveDate::from_ymd_opt(2026, 11, 27).unwrap(), time: hm(12, 0) }]);
    let list = next_alerts(&cfg, &cal, ct(2026, 11, 27, 11, 50), 2);
    assert_eq!(list[0].at, ct(2026, 11, 27, 12, 0));
    // 周五提前收盘后就是周末，下一根在周日开盘后
    assert_eq!(list[1].at, ct(2026, 11, 29, 17, 15));
}

#[test]
fn lead_seconds_and_merging() {
    let mut cfg = bars_only(TemplateId::CmeEquity, vec![15, 60], "America/Chicago", false);
    cfg.lead_seconds = 30;
    let a = &next_alerts(&cfg, &Calendar::default(), bj(2026, 10, 26, 21, 50), 1)[0];
    assert_eq!(a.at, bj(2026, 10, 26, 22, 0));
    assert_eq!(a.fire_at, a.at - Duration::seconds(30));
    assert_eq!(a.bars, vec![60, 15]);

    // 21:30 美股开盘与 15m 收盘合并为一条
    let mut cfg = bars_only(TemplateId::CmeEquity, vec![15], "America/Chicago", false);
    cfg.keys = keys_only(&["us_open"]).keys;
    let a = &next_alerts(&cfg, &Calendar::default(), bj(2026, 10, 26, 21, 20), 1)[0];
    assert_eq!(bj_hm(a.at), "21:30");
    assert_eq!(a.bars, vec![15]);
    assert_eq!(a.keys, vec!["美股开盘".to_string()]);
    assert_eq!(a.session, "欧盘 / 美盘");
}

#[test]
fn no_backfill_strictly_after() {
    // 正好在收盘时刻查询，返回的是下一根，不重复当前这根
    let cfg = bars_only(TemplateId::CmeEquity, vec![15], "America/Chicago", false);
    let t = bj(2026, 10, 26, 22, 0);
    assert_eq!(next_alerts(&cfg, &Calendar::default(), t, 1)[0].at, bj(2026, 10, 26, 22, 15));
}

#[test]
fn boundary_resets_at_local_midnight() {
    // 25 分钟周期不能整除 1440，每天 00:00 重新开始
    let b = next_boundary(chrono_tz::UTC, 25, "2026-10-26T23:50:00Z".parse().unwrap());
    assert_eq!(b, "2026-10-27T00:00:00Z".parse::<DateTime<Utc>>().unwrap());
}

#[test]
fn config_normalize_fills_missing() {
    let c: Config = serde_json::from_str(r#"{"periods":[15,15,0,5],"keys":[]}"#).unwrap();
    let c = c.normalized();
    assert_eq!(c.periods, vec![5, 15]);
    assert_eq!(c.keys.len(), keys::all().len());
    assert_eq!(c.templates.len(), TemplateId::ALL.len());
    assert_eq!(c.contracts.len(), ContractId::ALL.len());
}

#[test]
fn unknown_contract_ids_are_dropped_and_dates_parse() {
    let c: Config = serde_json::from_str(
        r#"{"contracts":[{"id":"legacy","enabled":true},{"id":"es","enabled":true,"roll_override":"2026-12-08"}]}"#,
    )
    .unwrap();
    assert_eq!(
        c.contracts,
        vec![ContractSetting {
            id: ContractId::Es,
            enabled: true,
            roll_override: NaiveDate::from_ymd_opt(2026, 12, 8)
        }]
    );
}

#[test]
fn contract_roll_alerts_one_day_and_one_hour_before() {
    let mut cfg = Config::default();
    cfg.templates.clear();
    cfg.periods.clear();
    cfg.keys.clear();
    cfg.news_enabled = false;
    cfg.contracts = vec![ContractSetting { id: ContractId::Es, enabled: true, roll_override: None }];
    let from = chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 12, 9, 0, 0, 0).unwrap();
    let list = next_alerts(&cfg, &Calendar::default(), from, 2);
    assert_eq!(list[0].rolls, vec!["ESZ6 换月".to_string()]);
    assert_eq!(list[0].fire_at, chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 12, 9, 14, 30, 0).unwrap());
    assert_eq!(list[0].at, chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 12, 10, 14, 30, 0).unwrap());
    assert_eq!(list[1].fire_at, chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 12, 10, 13, 30, 0).unwrap());
}

#[test]
fn unknown_template_ids_are_dropped_without_losing_config() {
    let c: Config = serde_json::from_str(
        r#"{"periods":[30],"templates":[{"id":"legacy_gold","enabled":true},{"id":"cme_equity","enabled":false}]}"#,
    )
    .unwrap();
    assert_eq!(c.periods, vec![30]);
    assert_eq!(c.templates, vec![TemplateSetting { id: TemplateId::CmeEquity, enabled: false, weekend: false }]);
    // 补齐缺失的 CME 模板后，仍然只保留 3 个品种。
    assert_eq!(c.normalized().templates.len(), TemplateId::ALL.len());
}

// ---------------- 财经日历 ----------------

const FF_SAMPLE: &str = r#"[
 {"title":"Non-Farm Employment Change","country":"USD","date":"2026-11-06T08:30:00-05:00","impact":"High","forecast":"120K","previous":"95K"},
 {"title":"Unemployment Rate","country":"USD","date":"2026-11-06T08:30:00-05:00","impact":"High","forecast":"4.3%","previous":"4.3%"},
 {"title":"Average Hourly Earnings m/m","country":"USD","date":"2026-11-06T08:30:00-05:00","impact":"Medium","forecast":"0.3%","previous":"0.3%"},
 {"title":"ECB Press Conference","country":"EUR","date":"2026-11-06T08:45:00-05:00","impact":"High","forecast":"","previous":""},
 {"title":"Bank Holiday","country":"JPY","date":"2026-11-03T00:00:00-05:00","impact":"Holiday","forecast":"","previous":""},
 {"title":"Bad","country":"USD","date":"not a date","impact":"High"},
 {"title":"Crude Oil Inventories","country":"USD","date":"2026-11-04T10:30:00-05:00","impact":"Low","forecast":"","previous":""}
]"#;

fn news_cfg() -> Config {
    let mut c = Config::default();
    c.periods.clear();
    c.keys.clear();
    c.contracts.clear();
    c.news_prewarn_minutes = 0;
    c
}

#[test]
fn news_parse_skips_bad_rows_and_converts_tz() {
    let ev = super::news::parse(FF_SAMPLE).unwrap();
    assert_eq!(ev.len(), 6);
    // 美东冬令时 08:30 = 北京时间 21:30
    assert_eq!(bj_hm(ev.iter().find(|e| e.title.starts_with("Non-Farm")).unwrap().at), "21:30");
}

#[test]
fn news_alert_merges_same_minute_and_filters_currency() {
    let ev = super::news::parse(FF_SAMPLE).unwrap();
    let cfg = news_cfg(); // 默认：USD，高+中，提前 2 分钟
    let a = super::schedule::Planner::with_news(&cfg, &Calendar::default(), &ev, bj(2026, 11, 6, 12, 0))
        .next_one(bj(2026, 11, 6, 12, 0))
        .unwrap();
    assert_eq!(bj_hm(a.fire_at), "21:28");
    assert_eq!(bj_hm(a.at), "21:30");
    assert_eq!(a.news.len(), 3, "非农、失业率、时薪同一分钟合并");
    assert!(a.news.iter().all(|n| n.starts_with("USD")), "EUR 不在关注列表");
}

#[test]
fn news_low_impact_and_disabled_are_ignored() {
    let ev = super::news::parse(FF_SAMPLE).unwrap();
    let cfg = news_cfg();
    // 11-04 的原油库存是“低”，不提醒；下一条应是 11-06 的非农
    let p = super::schedule::Planner::with_news(&cfg, &Calendar::default(), &ev, bj(2026, 11, 4, 0, 0));
    assert_eq!(p.next_one(bj(2026, 11, 4, 0, 0)).unwrap().at, bj(2026, 11, 6, 21, 30));
    let mut off = news_cfg();
    off.news_enabled = false;
    let p = super::schedule::Planner::with_news(&off, &Calendar::default(), &ev, bj(2026, 11, 4, 0, 0));
    assert!(p.next_one(bj(2026, 11, 4, 0, 0)).is_none());
}

#[test]
fn risk_window_marks_alerts_near_high_impact_news() {
    use super::news;
    let json = r#"[
      {"title":"Non-Farm Employment Change","country":"USD","date":"2026-11-06T08:30:00-05:00","impact":"High","forecast":"","previous":""},
      {"title":"Unemployment Rate","country":"USD","date":"2026-11-06T08:30:00-05:00","impact":"High","forecast":"","previous":""},
      {"title":"ISM Services PMI","country":"USD","date":"2026-11-06T10:00:00-05:00","impact":"Medium","forecast":"","previous":""}
    ]"#;
    let ev = news::parse(json).unwrap();
    let w = news::risk_windows(&ev, &["USD".into()], 5, 10);
    // 同一时刻的两条高重要度合并成一个窗口，中等重要度不算
    assert_eq!(w.len(), 1);
    assert_eq!(w[0].0, chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 11, 6, 13, 25, 0).unwrap());
    assert_eq!(w[0].1, chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 11, 6, 13, 40, 0).unwrap());

    let cfg = Config { news_impacts: vec![], ..Config::default() };
    let cal = Calendar::default();
    let from = chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 11, 6, 13, 20, 0).unwrap();
    let p = super::schedule::Planner::with_news(&cfg, &cal, &ev, from);
    let a = p.upcoming(from, 4);
    // 13:30 和 13:45（UTC）的 15 分钟收盘：前者在窗口内，后者已离开
    let at = |h, m| chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 11, 6, h, m, 0).unwrap();
    let r = |t| a.iter().find(|x| x.at == t).map(|x| x.risk.is_some());
    assert_eq!(r(at(13, 30)), Some(true));
    assert_eq!(r(at(13, 45)), Some(false));
}

// ---------------- 节假日规则 ----------------

#[test]
fn holiday_rules_known_years() {
    use super::holidays::{easter, year};
    let d = |y, m, dd| NaiveDate::from_ymd_opt(y, m, dd).unwrap();
    assert_eq!(easter(2026), d(2026, 4, 5));
    assert_eq!(easter(2027), d(2027, 3, 28));

    let (closed, early) = year(2026);
    assert!(closed.contains(&d(2026, 1, 1)));
    assert!(closed.contains(&d(2026, 4, 3))); // 耶稣受难日
    assert!(closed.contains(&d(2026, 12, 25)));
    let at = |date| early.iter().find(|e| e.date == date).map(|e| e.time);
    assert_eq!(at(d(2026, 11, 26)), Some(hm(12, 0))); // 感恩节
    assert_eq!(at(d(2026, 11, 27)), Some(hm(12, 15))); // 感恩节次日
    assert_eq!(at(d(2026, 12, 24)), Some(hm(12, 15))); // 平安夜
    assert_eq!(at(d(2026, 7, 3)), Some(hm(12, 0))); // 独立日周六 → 周五观察

    // 2027 年圣诞是周六，观察日周五 12/24，平安夜不再单独提前收盘
    let (closed, early) = year(2027);
    assert!(closed.contains(&d(2027, 12, 24)));
    assert!(!early.iter().any(|e| e.date == d(2027, 12, 24)));
    // 2028 年元旦是周六：不往前挪到 2027-12-31
    let (closed, _) = year(2028);
    assert!(!closed.iter().any(|x| chrono::Datelike::year(x) == 2027));
}

#[test]
fn holiday_overrides_apply() {
    use super::holidays::{build, Overrides};
    let d = NaiveDate::from_ymd_opt(2026, 11, 27).unwrap();
    let extra = NaiveDate::from_ymd_opt(2026, 1, 9).unwrap();
    let mut o = Overrides::default();
    o.normal.insert("cme".into(), vec![d]);
    o.closed.insert("cme".into(), vec![extra]);
    let cal = build(&[o]);
    assert!(!cal.early_close["cme"].iter().any(|e| e.date == d));
    assert!(cal.closed["cme"].contains(&extra));
    // 远期年份也有数据，不会过期
    assert!(cal.closed["cme"].contains(&NaiveDate::from_ymd_opt(2040, 12, 25).unwrap()));
}

#[test]
fn lead_seconds_applies_to_key_points() {
    // 提前 30 秒时，21:30 的美股开盘和 15m 收盘仍合并成一条，在 21:29:30 响，21:30 不再单独响
    let mut cfg = bars_only(TemplateId::CmeEquity, vec![15], "America/Chicago", false);
    cfg.keys = keys_only(&["us_open"]).keys;
    cfg.lead_seconds = 30;
    let list = next_alerts(&cfg, &Calendar::default(), bj(2026, 10, 26, 21, 20), 2);
    assert_eq!(list[0].fire_at, bj(2026, 10, 26, 21, 30) - Duration::seconds(30));
    assert_eq!(list[0].keys, vec!["美股开盘".to_string()]);
    assert_eq!(list[0].bars, vec![15]);
    assert_eq!(list[1].at, bj(2026, 10, 26, 21, 45));
}

#[test]
fn custom_lead_seconds_clamped() {
    let c: Config = serde_json::from_str(r#"{"lead_seconds":45}"#).unwrap();
    assert_eq!(c.normalized().lead_seconds, 45);
    let c: Config = serde_json::from_str(r#"{"lead_seconds":5000}"#).unwrap();
    assert_eq!(c.normalized().lead_seconds, 600);
}

#[test]
fn high_impact_news_gets_extra_prewarn() {
    let ev = super::news::parse(FF_SAMPLE).unwrap();
    let mut cfg = news_cfg();
    cfg.news_prewarn_minutes = 15;
    let p = super::schedule::Planner::with_news(&cfg, &Calendar::default(), &ev, bj(2026, 11, 6, 12, 0));
    let list = p.upcoming(bj(2026, 11, 6, 12, 0), 2);
    // 21:15 预警只含高重要度（非农、失业率），21:28 常规提醒含全部 3 条
    assert_eq!(bj_hm(list[0].fire_at), "21:15");
    assert_eq!(bj_hm(list[0].at), "21:30");
    assert_eq!(list[0].news.len(), 2);
    assert_eq!(bj_hm(list[1].fire_at), "21:28");
    assert_eq!(list[1].news.len(), 3);
}

#[test]
fn quiet_hours_mute_bars_only() {
    let mut c = bars_only(TemplateId::CmeCrypto, vec![60], "America/Chicago", false);
    c.quiet_enabled = true;
    c.quiet_start = 23 * 60;
    c.quiet_end = 7 * 60;
    // 周二 22:30 北京时间开始：23:00–06:59 的整点被跳过；
    // 06:00–07:00 北京时间是 CME 每日维护，恢复后的第一根是 08:00 收盘。
    let list = next_alerts(&c, &Calendar::default(), bj(2026, 11, 3, 22, 30), 2);
    assert_eq!(bj_hm(list[0].at), "08:00");
    assert_eq!(bj_hm(list[1].at), "09:00");
    // 关键时点不受静音影响
    let mut k = keys_only(&["us_open"]);
    k.quiet_enabled = true;
    k.quiet_start = 0;
    k.quiet_end = 1439;
    assert_eq!(next_alerts(&k, &Calendar::default(), bj(2026, 11, 3, 12, 0), 1).len(), 1);
}

#[test]
fn hotkey_presets_parse_and_invalid_falls_back() {
    for h in super::config::HOTKEYS {
        assert!(h.parse::<tauri_plugin_global_shortcut::Shortcut>().is_ok(), "无法解析快捷键 {h}");
    }
    let mut c = Config::default();
    c.hotkey = Some("ctrl+alt+delete".into());
    assert_eq!(c.normalized().hotkey.as_deref(), Some("ctrl+alt+p"));
    let mut off = Config::default();
    off.hotkey = None;
    assert_eq!(off.normalized().hotkey, None);
}

#[test]
fn window_geometry_is_normalized() {
    let mut c = Config::default();
    c.window_size = Some((100.0, 99_999.0));
    c.window_pos = Some((f64::NAN, 12.0));
    let n = c.normalized();
    // 恢复窗口时至少 760×520，最大 10000；NaN 坐标直接丢弃
    assert_eq!(n.window_size, Some((760.0, 10_000.0)));
    assert_eq!(n.window_pos, None);
}
