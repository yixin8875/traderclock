//! “今日”页时间轴数据：北京时间某一天内的时段色带、CME 休市、关键时点。

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc, Weekday};
use chrono_tz::{America, Asia, Europe, Tz};
use serde::Serialize;

use crate::engine::config::Config;
use crate::engine::contracts;
use crate::engine::keys;
use crate::engine::market::{template, Calendar, Interval};
use crate::engine::news::{self, Impact, NewsEvent};
use crate::engine::tz::{hm, is_dst, local_to_utc};

#[derive(Serialize)]
pub struct Band {
    pub name: &'static str,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct Mark {
    pub name: String,
    pub at: DateTime<Utc>,
    pub major: bool,
    pub enabled: bool,
    /// 来自财经日历的数据发布
    pub news: bool,
}

#[derive(Serialize)]
pub struct Risk {
    pub name: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct Today {
    pub day_start: DateTime<Utc>,
    /// 亚盘 / 欧盘 / 美盘，作为市场背景，不代表用户启用的品种
    pub sessions: Vec<Band>,
    /// 已启用品种全部不能交易的时间（节假日、提前收盘、每日维护、周末）
    pub closed: Vec<Band>,
    pub marks: Vec<Mark>,
    /// 高重要度数据前后的风险窗口（已裁到当天）
    pub risks: Vec<Risk>,
    pub dst_note: String,
    /// 全天休市时给出原因；部分休市为 None
    pub day_note: Option<String>,
}

fn weekday(d: NaiveDate) -> bool {
    !matches!(d.weekday(), Weekday::Sat | Weekday::Sun)
}

pub fn build(cfg: &Config, cal: &Calendar, events: &[NewsEvent], now: DateTime<Utc>) -> Today {
    let bj = Asia::Shanghai;
    let day = now.with_timezone(&bj).date_naive();
    let (a, b) = (local_to_utc(bj, day, hm(0, 0)), local_to_utc(bj, day + Duration::days(1), hm(0, 0)));
    let clip = |s: DateTime<Utc>, e: DateTime<Utc>| (s.max(a), e.min(b));

    let defs: [(&'static str, Tz, (u32, u32), (u32, u32)); 3] = [
        ("亚盘", Asia::Tokyo, (9, 0), (15, 0)),
        ("欧盘", Europe::London, (8, 0), (16, 30)),
        ("美盘", America::New_York, (9, 30), (16, 0)),
    ];
    let mut sessions = Vec::new();
    for (name, tz, f, t) in defs {
        for dd in -1..=1 {
            let d = (a + Duration::hours(12)).with_timezone(&tz).date_naive() + Duration::days(dd);
            if !weekday(d) {
                continue;
            }
            let (s, e) = clip(local_to_utc(tz, d, hm(f.0, f.1)), local_to_utc(tz, d, hm(t.0, t.1)));
            if s < e {
                sessions.push(Band { name, start: s, end: e });
            }
        }
    }

    // 休市区间取“已启用品种交易时段的补集”，所以会跟随品种、节假日和提前收盘变化。
    let enabled: Vec<_> = cfg.templates.iter().filter(|t| t.enabled).collect();
    let mut closed = Vec::new();
    let mut day_note = None;
    if enabled.is_empty() {
        closed.push(Band { name: "休市", start: a, end: b });
        day_note = Some("未启用品种".to_string());
    } else {
        let mut open: Vec<Interval> = enabled
            .iter()
            .flat_map(|t| template(t.id).intervals(a, b, t.weekend, cal))
            .filter_map(|(s, e)| {
                let (s, e) = (s.max(a), e.min(b));
                (s < e).then_some((s, e))
            })
            .collect();
        open.sort();
        // 多个品种重叠的时段合并，补集才不会切出很多碎片
        let mut merged: Vec<Interval> = Vec::new();
        for (s, e) in open {
            match merged.last_mut() {
                Some(last) if s <= last.1 => last.1 = last.1.max(e),
                _ => merged.push((s, e)),
            }
        }
        let mut cursor = a;
        for (s, e) in &merged {
            if *s > cursor {
                closed.push(Band { name: "休市", start: cursor, end: *s });
            }
            cursor = cursor.max(*e);
        }
        if cursor < b {
            closed.push(Band { name: "休市", start: cursor, end: b });
        }
        let all_day = closed.len() == 1 && closed[0].start <= a && closed[0].end >= b;
        if all_day {
            day_note = Some(if matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
                "周末休市"
            } else {
                "今日休市"
            }.to_string());
        }
    }

    let mut marks: Vec<Mark> = keys::all()
        .iter()
        .filter_map(|k| {
            let at = k.next_after(a - Duration::seconds(1));
            (at < b).then(|| Mark {
                name: k.name.to_string(),
                at,
                major: k.major,
                enabled: cfg.keys.iter().any(|s| s.id == k.id && s.enabled),
                news: false,
            })
        })
        .collect();
    // 换月/到期也放在时间轴上；只显示已启用合约，避免把未交易的品种画进来。
    for c in cfg.contracts.iter().filter(|c| c.enabled) {
        let meta = c.id.meta();
        for e in contracts::events(c.id, now, c.roll_override) {
            let at = local_to_utc(meta.tz, e.date, meta.time);
            if at < a || at >= b {
                continue;
            }
            let what = if e.label.contains("换月") && e.label.contains("到期") {
                "换月/到期"
            } else if e.kind == "roll" {
                "换月"
            } else {
                "到期"
            };
            marks.push(Mark {
                name: format!("{} {}", e.code, what),
                at,
                major: true,
                enabled: true,
                news: false,
            });
        }
    }
    // 时间轴上显示关注币种的高、中数据；只有设置里勾选的程度才算“会提醒”
    let shown = [Impact::High, Impact::Medium];
    for e in news::select(events, &cfg.news_currencies, &shown) {
        if e.at >= a && e.at < b {
            marks.push(Mark {
                name: e.label(),
                at: e.at,
                major: e.impact == Impact::High,
                enabled: cfg.news_enabled && cfg.news_impacts.contains(&e.impact),
                news: true,
            });
        }
    }
    marks.sort_by_key(|m| m.at);

    let risks = if cfg.news_enabled && cfg.risk_enabled {
        news::risk_windows(events, &cfg.news_currencies, cfg.risk_before_minutes, cfg.risk_after_minutes)
            .into_iter()
            .filter_map(|(s, e, name)| {
                let (s, e) = clip(s, e);
                (s < e).then_some(Risk { name, start: s, end: e })
            })
            .collect()
    } else {
        vec![]
    };

    let (l, n) = (is_dst(Europe::London, now), is_dst(America::New_York, now));
    let dst_note = match (l, n) {
        (true, true) => "美欧均为夏令时".into(),
        (false, false) => "美欧均为冬令时".into(),
        (false, true) => "欧洲已切冬令时，美国仍为夏令时（不同步周）".into(),
        (true, false) => "美国已切夏令时，欧洲仍为冬令时（不同步周）".into(),
    };

    Today { day_start: a, sessions, closed, marks, risks, dst_note, day_note }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::config::ContractSetting;
    use crate::engine::contracts::ContractId;
    use crate::engine::market::TemplateId;
    use chrono::TimeZone;

    fn at(y: i32, m: u32, d: u32, h: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, 0, 0).unwrap()
    }

    fn only(id: TemplateId) -> Config {
        let mut cfg = Config::default();
        for t in &mut cfg.templates {
            t.enabled = t.id == id;
        }
        cfg
    }

    #[test]
    fn no_enabled_templates_closes_the_whole_day() {
        let mut cfg = Config::default();
        for t in &mut cfg.templates {
            t.enabled = false;
        }
        let today = build(&cfg, &Calendar::default(), &[], at(2026, 11, 4, 4));
        assert_eq!(today.day_note.as_deref(), Some("未启用品种"));
        assert_eq!(today.closed.len(), 1);
        assert_eq!(today.closed[0].start, today.day_start);
        assert_eq!(today.closed[0].end, today.day_start + Duration::days(1));
    }

    #[test]
    fn holiday_closure_covers_the_trading_day() {
        let mut cal = Calendar::default();
        cal.closed.insert("cme".into(), vec![NaiveDate::from_ymd_opt(2026, 11, 26).unwrap()]);
        let now = at(2026, 11, 26, 4); // 北京时间 12:00
        let today = build(&only(TemplateId::CmeEquity), &cal, &[], now);
        assert!(today.day_note.is_none(), "北京时间当天只休半天，不应标成全天休市");
        assert!(today.closed.iter().any(|b| b.start <= now && now < b.end), "感恩节白天应处于休市区间");
    }

    #[test]
    fn weekend_marks_a_full_closed_day() {
        let today = build(&only(TemplateId::CmeEquity), &Calendar::default(), &[], at(2026, 11, 8, 4));
        assert_eq!(today.day_note.as_deref(), Some("周末休市"));
        assert!(today.closed.len() == 1);
    }

    #[test]
    fn contract_roll_and_expiry_appear_on_today_timeline() {
        let mut cfg = only(TemplateId::CmeEquity);
        cfg.contracts = vec![ContractSetting { id: ContractId::Es, enabled: true, roll_override: None }];
        // 北京时间 2026-12-10 12:00：ESZ6 当天 22:30 换月
        let roll_day = build(&cfg, &Calendar::default(), &[], at(2026, 12, 10, 4));
        assert!(roll_day.marks.iter().any(|m| m.name == "ESZ6 换月"));
        // 北京时间 2026-12-18 12:00：ESZ6 当天 22:30 到期
        let expiry_day = build(&cfg, &Calendar::default(), &[], at(2026, 12, 18, 4));
        assert!(expiry_day.marks.iter().any(|m| m.name == "ESZ6 到期"));
    }
}
