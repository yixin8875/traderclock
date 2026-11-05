//! 节假日按规则自动计算，不依赖下载，每年自动生效。
//!
//! 规则依据 CME Globex 股指 / 金属产品的惯例（芝加哥时间，日期指“交易日”）：
//! - 全天休市：元旦、耶稣受难日、圣诞节（遇周末顺延到观察日）。
//! - 12:00 CT 提前收盘：马丁·路德·金日、总统日、阵亡将士纪念日、六月节、独立日、劳动节、感恩节。
//! - 12:15 CT 提前收盘：感恩节次日（周五）、平安夜（工作日且不是圣诞观察日时）。
//!
//! CME 偶尔会临时调整（例如国丧日休市），这类情况写进 calendar/overrides.json，
//! 或放到配置目录下的 calendar.json，会覆盖规则结果。

use chrono::{Datelike, Duration, NaiveDate, NaiveTime, Weekday};

use super::market::{Calendar, EarlyClose};
use super::tz::hm;

/// 生成规则日历的年份范围。覆盖到 2099 年，程序不会因为跨年而“过期”。
pub const FIRST_YEAR: i32 = 2024;
pub const LAST_YEAR: i32 = 2099;

/// 节假日日历只服务 CME 系列品种。
const GROUPS: [&str; 1] = ["cme"];

fn ymd(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).expect("有效日期")
}

/// 某月第 n 个星期几（n 从 1 开始）。
fn nth_weekday(y: i32, m: u32, wd: Weekday, n: u32) -> NaiveDate {
    NaiveDate::from_weekday_of_month_opt(y, m, wd, n as u8).expect("有效日期")
}

/// 某月最后一个星期几。
fn last_weekday(y: i32, m: u32, wd: Weekday) -> NaiveDate {
    let next = if m == 12 { ymd(y + 1, 1, 1) } else { ymd(y, m + 1, 1) };
    let mut d = next - Duration::days(1);
    while d.weekday() != wd {
        d -= Duration::days(1);
    }
    d
}

/// 美国联邦假日观察日：周六提前到周五，周日顺延到周一。
fn observed(d: NaiveDate) -> NaiveDate {
    match d.weekday() {
        Weekday::Sat => d - Duration::days(1),
        Weekday::Sun => d + Duration::days(1),
        _ => d,
    }
}

/// 复活节（公历，匿名算法）。
pub fn easter(y: i32) -> NaiveDate {
    let a = y % 19;
    let b = y / 100;
    let c = y % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = (h + l - 7 * m + 114) % 31 + 1;
    ymd(y, month as u32, day as u32)
}

/// 一年内的休市日和提前收盘。
pub fn year(y: i32) -> (Vec<NaiveDate>, Vec<EarlyClose>) {
    let mut closed = Vec::new();
    // 元旦：周六不往前挪到上一年 12/31（交易所惯例），周日顺延到周一
    let ny = ymd(y, 1, 1);
    if ny.weekday() != Weekday::Sat {
        closed.push(observed(ny));
    }
    closed.push(easter(y) - Duration::days(2)); // 耶稣受难日
    let xmas = observed(ymd(y, 12, 25));
    closed.push(xmas);

    let noon = hm(12, 0);
    let quarter: NaiveTime = hm(12, 15);
    let thanksgiving = nth_weekday(y, 11, Weekday::Thu, 4);
    let mut early: Vec<EarlyClose> = [
        nth_weekday(y, 1, Weekday::Mon, 3),  // 马丁·路德·金日
        nth_weekday(y, 2, Weekday::Mon, 3),  // 总统日
        last_weekday(y, 5, Weekday::Mon),    // 阵亡将士纪念日
        observed(ymd(y, 6, 19)),             // 六月节
        observed(ymd(y, 7, 4)),              // 独立日
        nth_weekday(y, 9, Weekday::Mon, 1),  // 劳动节
        thanksgiving,                        // 感恩节
    ]
    .into_iter()
    .map(|date| EarlyClose { date, time: noon })
    .collect();

    early.push(EarlyClose { date: thanksgiving + Duration::days(1), time: quarter });
    let eve = ymd(y, 12, 24);
    if !matches!(eve.weekday(), Weekday::Sat | Weekday::Sun) && eve != xmas {
        early.push(EarlyClose { date: eve, time: quarter });
    }
    (closed, early)
}

/// 覆盖文件：在规则结果之上增加休市、改提前收盘时间，或取消某个规则日期。
#[derive(Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(default)]
pub struct Overrides {
    pub version: String,
    pub closed: std::collections::HashMap<String, Vec<NaiveDate>>,
    pub early_close: std::collections::HashMap<String, Vec<EarlyClose>>,
    /// 规则算出来、但当年实际照常交易的日期，从休市和提前收盘里都移除。
    pub normal: std::collections::HashMap<String, Vec<NaiveDate>>,
}

/// 规则日历 + 覆盖。
pub fn build(overrides: &[Overrides]) -> Calendar {
    let mut cal = Calendar::default();
    for g in GROUPS {
        let (mut closed, mut early) = (Vec::new(), Vec::new());
        for y in FIRST_YEAR..=LAST_YEAR {
            let (c, e) = year(y);
            closed.extend(c);
            early.extend(e);
        }
        cal.closed.insert(g.into(), closed);
        cal.early_close.insert(g.into(), early);
    }
    let mut versions = vec!["规则".to_string()];
    for o in overrides {
        for (g, dates) in &o.normal {
            if !GROUPS.contains(&g.as_str()) {
                continue;
            }
            if let Some(v) = cal.closed.get_mut(g) {
                v.retain(|d| !dates.contains(d));
            }
            if let Some(v) = cal.early_close.get_mut(g) {
                v.retain(|e| !dates.contains(&e.date));
            }
        }
        for (g, dates) in &o.closed {
            if !GROUPS.contains(&g.as_str()) {
                continue;
            }
            let v = cal.closed.entry(g.clone()).or_default();
            v.extend(dates.iter().copied().filter(|d| !v.contains(d)).collect::<Vec<_>>());
        }
        for (g, list) in &o.early_close {
            if !GROUPS.contains(&g.as_str()) {
                continue;
            }
            let v = cal.early_close.entry(g.clone()).or_default();
            for e in list {
                v.retain(|x| x.date != e.date);
                v.push(e.clone());
            }
        }
        if !o.version.is_empty() {
            versions.push(o.version.clone());
        }
    }
    cal.version = versions.join(" + ");
    cal
}
