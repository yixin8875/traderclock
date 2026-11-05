//! 财经日历：ForexFactory 官方周数据文件（Fair Economy 发布）。
//! 地址：https://nfs.faireconomy.media/ff_calendar_thisweek.json
//! 只解析数据，不联网；下载在 lib.rs 的后台线程里做。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Impact {
    High,
    Medium,
    Low,
    Holiday,
}

impl Impact {
    pub fn label(self) -> &'static str {
        match self {
            Impact::High => "高",
            Impact::Medium => "中",
            Impact::Low => "低",
            Impact::Holiday => "假日",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NewsEvent {
    pub title: String,
    pub country: String,
    pub at: DateTime<Utc>,
    pub impact: Impact,
    pub forecast: String,
    pub previous: String,
}

impl NewsEvent {
    /// 提醒里显示的名字，例如 "USD Non-Farm Employment Change（高）"
    pub fn label(&self) -> String {
        format!("{} {}（{}）", self.country, self.title, self.impact.label())
    }
}

/// 原始文件里的一条记录。时间带时区偏移，例如 "2026-10-30T08:30:00-04:00"。
#[derive(Deserialize)]
struct Raw {
    title: String,
    country: String,
    date: String,
    impact: String,
    #[serde(default)]
    forecast: Option<String>,
    #[serde(default)]
    previous: Option<String>,
}

fn clean(s: Option<String>, max: usize) -> String {
    s.unwrap_or_default().trim().chars().filter(|c| !c.is_control()).take(max).collect()
}

/// 解析周数据。无法识别的记录直接跳过，不让整份文件作废。
pub fn parse(json: &str) -> Result<Vec<NewsEvent>, String> {
    let raws: Vec<Raw> = serde_json::from_str(json).map_err(|e| format!("数据格式无法识别：{e}"))?;
    let mut out: Vec<NewsEvent> = raws
        .into_iter()
        .filter_map(|r| {
            let at = DateTime::parse_from_rfc3339(r.date.trim()).ok()?.with_timezone(&Utc);
            let impact = match r.impact.trim().to_ascii_lowercase().as_str() {
                "high" => Impact::High,
                "medium" => Impact::Medium,
                "low" => Impact::Low,
                "holiday" => Impact::Holiday,
                _ => return None,
            };
            Some(NewsEvent {
                title: clean(Some(r.title), 80),
                country: clean(Some(r.country), 8).to_ascii_uppercase(),
                at,
                impact,
                forecast: clean(r.forecast, 20),
                previous: clean(r.previous, 20),
            })
        })
        .collect();
    out.sort_by_key(|e| e.at);
    Ok(out)
}

/// 按用户设置筛选：币种和重要程度。假日不作为提醒。
pub fn select<'a>(all: &'a [NewsEvent], currencies: &[String], impacts: &[Impact]) -> Vec<&'a NewsEvent> {
    all.iter()
        .filter(|e| e.impact != Impact::Holiday)
        .filter(|e| impacts.contains(&e.impact))
        .filter(|e| currencies.iter().any(|c| c.eq_ignore_ascii_case(&e.country)))
        .collect()
}

/// 风险窗口：关注币种的高重要度数据，公布前 `before`、公布后 `after` 分钟。
/// 返回 (开始, 结束, 数据名)，按开始时间排序；同一时刻的多条数据合并成一个窗口。
pub fn risk_windows(
    all: &[NewsEvent],
    currencies: &[String],
    before: u32,
    after: u32,
) -> Vec<(DateTime<Utc>, DateTime<Utc>, String)> {
    let (b, a) = (chrono::Duration::minutes(before as i64), chrono::Duration::minutes(after as i64));
    let mut out: Vec<(DateTime<Utc>, DateTime<Utc>, String)> = Vec::new();
    for e in select(all, currencies, &[Impact::High]) {
        let (s, t) = (e.at - b, e.at + a);
        match out.last_mut() {
            // 重叠的窗口合并，名字只保留第一条，避免弹窗写太长
            Some(last) if s <= last.1 => last.1 = last.1.max(t),
            _ => out.push((s, t, format!("{} {}", e.country, e.title))),
        }
    }
    out
}
