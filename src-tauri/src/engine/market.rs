//! 品种模板（交易时段）、节假日日历、当前时段标签。

use std::collections::HashMap;

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, Utc, Weekday};
use chrono_tz::{America, Asia, Europe, Tz};
use serde::{Deserialize, Serialize};

use super::tz::{hm, local_to_utc};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateId {
    CmeEquity,
    ComexGold,
    CmeCrypto,
}

impl TemplateId {
    pub const ALL: [TemplateId; 3] = [TemplateId::CmeEquity, TemplateId::ComexGold, TemplateId::CmeCrypto];

    /// 从配置里的 id 解析模板。旧版本或其他来源的未知 id 返回 None，
    /// 由配置反序列化直接忽略，避免一条失效记录让整份配置回退默认。
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "cme_equity" => Some(TemplateId::CmeEquity),
            "comex_gold" => Some(TemplateId::ComexGold),
            "cme_crypto" => Some(TemplateId::CmeCrypto),
            _ => None,
        }
    }
}

/// 每周重复的一段交易时间，按模板所在时区定义。
/// 从 `start_day` 的 `start` 开始，到 `days` 天后的 `end` 结束（可跨午夜）。
#[derive(Clone, Copy, Debug)]
pub struct Window {
    pub start_day: Weekday,
    pub start: NaiveTime,
    pub days: i64,
    pub end: NaiveTime,
    /// 周末时段，只有用户打开“周末提醒”时才生效。
    pub weekend: bool,
}

// id、name 留给后续“品种”页和日历覆盖功能使用
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct Template {
    pub id: TemplateId,
    pub name: &'static str,
    pub tz: Tz,
    /// 节假日日历分组。
    pub calendar: &'static str,
    pub windows: Vec<Window>,
}

/// CME Globex：周日 17:00 – 周五 16:00 CT，每日 16:00–17:00 休市。
fn globex_windows() -> Vec<Window> {
    [Weekday::Sun, Weekday::Mon, Weekday::Tue, Weekday::Wed, Weekday::Thu]
        .into_iter()
        .map(|d| Window { start_day: d, start: hm(17, 0), days: 1, end: hm(16, 0), weekend: false })
        .collect()
}

/// CME 加密 7×24：在 Globex 基础上加周末两段，仍保留每日 16:00–17:00 CT 维护。
fn cme_crypto_windows() -> Vec<Window> {
    let mut w = globex_windows();
    for d in [Weekday::Fri, Weekday::Sat] {
        w.push(Window { start_day: d, start: hm(17, 0), days: 1, end: hm(16, 0), weekend: true });
    }
    w
}

pub fn template(id: TemplateId) -> Template {
    let chicago = America::Chicago;
    match id {
        TemplateId::CmeEquity => Template { id, name: "CME 股指（ES / NQ）", tz: chicago, calendar: "cme", windows: globex_windows() },
        TemplateId::ComexGold => Template { id, name: "COMEX 黄金（GC）", tz: chicago, calendar: "cme", windows: globex_windows() },
        TemplateId::CmeCrypto => Template { id, name: "CME 比特币（BTC）", tz: chicago, calendar: "cme", windows: cme_crypto_windows() },
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EarlyClose {
    pub date: NaiveDate,
    /// 当地时间，格式 "12:00:00"
    pub time: NaiveTime,
}

/// 节假日日历。键是日历分组（"cme"），日期指“交易日”，即时段结束的那一天。
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Calendar {
    pub version: String,
    pub closed: HashMap<String, Vec<NaiveDate>>,
    pub early_close: HashMap<String, Vec<EarlyClose>>,
}

impl Calendar {
    fn is_closed(&self, group: &str, d: NaiveDate) -> bool {
        self.closed.get(group).is_some_and(|v| v.contains(&d))
    }
    fn early_close(&self, group: &str, d: NaiveDate) -> Option<NaiveTime> {
        self.early_close.get(group)?.iter().find(|e| e.date == d).map(|e| e.time)
    }
}

pub type Interval = (DateTime<Utc>, DateTime<Utc>);

impl Template {
    /// 列出与 [from, to) 有交集的所有交易区间（UTC），已应用节假日和提前收盘。
    pub fn intervals(&self, from: DateTime<Utc>, to: DateTime<Utc>, weekend: bool, cal: &Calendar) -> Vec<Interval> {
        let first = from.with_timezone(&self.tz).date_naive() - Duration::days(2);
        let last = to.with_timezone(&self.tz).date_naive() + Duration::days(1);
        let mut out = Vec::new();
        let mut d = first;
        while d <= last {
            for w in self.windows.iter().filter(|w| w.start_day == d.weekday() && (weekend || !w.weekend)) {
                let trade_day = d + Duration::days(w.days);
                if cal.is_closed(self.calendar, trade_day) {
                    continue;
                }
                let s = local_to_utc(self.tz, d, w.start);
                let mut e = local_to_utc(self.tz, trade_day, w.end);
                if let Some(t) = cal.early_close(self.calendar, trade_day) {
                    e = e.min(local_to_utc(self.tz, trade_day, t));
                }
                if s < e && e > from && s < to {
                    out.push((s, e));
                }
            }
            d += Duration::days(1);
        }
        out.sort();
        out
    }

    #[cfg(test)]
    pub fn is_open(&self, t: DateTime<Utc>, weekend: bool, cal: &Calendar) -> bool {
        self.intervals(t, t + Duration::seconds(1), weekend, cal)
            .iter()
            .any(|(s, e)| *s <= t && t < *e)
    }
}

/// 当前所处的主要时段：亚盘（东京）、欧盘（伦敦）、美盘（纽约），可能重叠。
pub fn session_label(t: DateTime<Utc>) -> String {
    let defs: [(&str, Tz, NaiveTime, NaiveTime); 3] = [
        ("亚盘", Asia::Tokyo, hm(9, 0), hm(15, 0)),
        ("欧盘", Europe::London, hm(8, 0), hm(16, 30)),
        ("美盘", America::New_York, hm(9, 30), hm(16, 0)),
    ];
    let hits: Vec<&str> = defs
        .iter()
        .filter(|(_, tz, s, e)| {
            let l = t.with_timezone(tz);
            let wd = l.weekday();
            wd != Weekday::Sat && wd != Weekday::Sun && l.time() >= *s && l.time() < *e
        })
        .map(|(n, ..)| *n)
        .collect();
    if hits.is_empty() { "非主要时段".into() } else { hits.join(" / ") }
}
