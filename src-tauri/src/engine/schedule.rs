//! 计算接下来的提醒。每次都从“当前时刻”重新算下一个绝对时间点，不累加定时器，
//! 所以睡眠唤醒、改系统时间、夏令时切换后都不会漂移。

use chrono::{DateTime, Duration, Timelike, Utc};
use chrono_tz::Tz;
use serde::Serialize;

use super::config::Config;
use super::contracts;
use super::keys::{self, KeyPoint};
use super::market::{session_label, template, Calendar, Interval};
use super::news::{self, NewsEvent};
use super::tz::{hm, local_to_utc};

/// 向后最多看多少天（覆盖长假）。
const HORIZON_DAYS: i64 = 10;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Alert {
    /// 实际触发时刻（= 事件时刻 - 提前量）
    pub fire_at: DateTime<Utc>,
    /// 事件时刻（K 线收盘或关键时点）
    pub at: DateTime<Utc>,
    /// 同时收盘的周期，从大到小，例如 [60, 15]
    pub bars: Vec<u32>,
    /// 同时发生的关键时点名称
    pub keys: Vec<String>,
    /// 同时发布的财经数据，例如 "USD CPI m/m（高）"
    pub news: Vec<String>,
    /// 同时发生的合约换月，例如 "ESZ6 换月"
    pub rolls: Vec<String>,
    /// 事件发生时所在的主要时段
    pub session: String,
    /// 事件时刻处于高重要度数据的风险窗口内时，填该数据的名字
    pub risk: Option<String>,
}

/// 严格晚于 `t` 的下一个 K 线边界（按 `tz` 的自然日对齐，每天 00:00 重新开始计数）。
pub fn next_boundary(tz: Tz, period_min: u32, t: DateTime<Utc>) -> DateTime<Utc> {
    let mut t = t;
    loop {
        let l = t.with_timezone(&tz);
        let date = l.date_naive();
        let next = (l.hour() * 60 + l.minute()) / period_min * period_min + period_min;
        let cand = if next >= 1440 {
            local_to_utc(tz, date + Duration::days(1), hm(0, 0))
        } else {
            local_to_utc(tz, date, hm(next / 60, next % 60))
        };
        if cand > t {
            return cand;
        }
        // 夏令时结束时的重复小时：往后挪一分钟再算
        t += Duration::minutes(1);
    }
}

pub struct Planner<'a> {
    cfg: &'a Config,
    open: Vec<Interval>,
    keys: Vec<(KeyPoint, Duration)>,
    align: Tz,
    lead: Duration,
    /// 已筛选的财经数据：(触发时刻, 发布时刻, 显示名)，高重要度的额外预警也在里面
    news: Vec<(DateTime<Utc>, DateTime<Utc>, String)>,
    /// 已启用合约的换月提醒：(触发时刻, 换月时刻, 显示名)
    rolls: Vec<(DateTime<Utc>, DateTime<Utc>, String)>,
    risks: Vec<(DateTime<Utc>, DateTime<Utc>, String)>,
}

impl<'a> Planner<'a> {
    #[cfg(test)]
    pub fn new(cfg: &'a Config, cal: &Calendar, from: DateTime<Utc>) -> Self {
        Self::with_news(cfg, cal, &[], from)
    }

    pub fn with_news(cfg: &'a Config, cal: &Calendar, events: &[NewsEvent], from: DateTime<Utc>) -> Self {
        let (a, b) = (from - Duration::days(1), from + Duration::days(HORIZON_DAYS + 1));
        let mut open: Vec<Interval> = cfg
            .templates
            .iter()
            .filter(|t| t.enabled)
            .flat_map(|t| template(t.id).intervals(a, b, t.weekend, cal))
            .collect();
        open.sort();
        let all = keys::all();
        let keys = cfg
            .keys
            .iter()
            .filter(|k| k.enabled)
            .filter_map(|k| {
                let kp = all.iter().find(|x| x.id == k.id)?.clone();
                Some((kp, Duration::minutes(k.lead_minutes as i64)))
            })
            .collect();
        let mut news: Vec<(DateTime<Utc>, DateTime<Utc>, String)> = Vec::new();
        if cfg.news_enabled {
            let lead = Duration::minutes(cfg.news_lead_minutes as i64);
            let pre = Duration::minutes(cfg.news_prewarn_minutes as i64);
            for e in news::select(events, &cfg.news_currencies, &cfg.news_impacts) {
                news.push((e.at - lead, e.at, e.label()));
                // 预警比普通提前量更早才有意义
                if e.impact == news::Impact::High && cfg.news_prewarn_minutes > cfg.news_lead_minutes {
                    news.push((e.at - pre, e.at, e.label()));
                }
            }
        }
        let risks = if cfg.news_enabled && cfg.risk_enabled {
            news::risk_windows(events, &cfg.news_currencies, cfg.risk_before_minutes, cfg.risk_after_minutes)
        } else {
            vec![]
        };
        let mut rolls = Vec::new();
        for c in cfg.contracts.iter().filter(|c| c.enabled) {
            if let Some(info) = contracts::next_roll(c.id, from, c.roll_override) {
                let name = format!("{} 换月", info.current_code);
                // 换月前 1 天、1 小时各提醒一次；已经过去的时间点由 next_one 自动跳过。
                for lead in [Duration::days(1), Duration::hours(1)] {
                    rolls.push((info.roll_at - lead, info.roll_at, name.clone()));
                }
            }
        }
        Planner {
            cfg,
            risks,
            open,
            keys,
            align: cfg.align_tz(),
            lead: Duration::seconds(cfg.lead_seconds as i64),
            news,
            rolls,
        }
    }

    /// `t` 处于哪个风险窗口内（含两端），返回数据名。
    pub fn risk_at(&self, t: DateTime<Utc>) -> Option<String> {
        self.risks.iter().find(|(s, e, _)| *s <= t && t <= *e).map(|r| r.2.clone())
    }

    /// 任一已启用品种在 `t` 时刻是否在交易。
    pub fn is_open(&self, t: DateTime<Utc>) -> bool {
        self.open.iter().any(|(s, e)| *s <= t && t < *e)
    }

    /// 严格晚于 `after` 的下一个开盘时刻。用于“暂停到下个时段”。
    pub fn next_open_start(&self, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.open.iter().map(|(s, _)| *s).filter(|s| *s > after).min()
    }

    /// 下一个触发时刻晚于 `after` 的 K 线收盘。收盘前 1 秒必须处于交易时段内。
    fn next_bar(&self, period: u32, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        let end = after + Duration::days(HORIZON_DAYS);
        let mut cur = after + self.lead;
        while cur < end {
            let b = next_boundary(self.align, period, cur);
            if self.is_open(b - Duration::seconds(1)) && !self.cfg.is_quiet(b) {
                return Some(b);
            }
            cur = b;
        }
        None
    }

    /// 严格晚于 `after` 的下一次提醒，同一时刻的事件合并为一条。
    pub fn next_one(&self, after: DateTime<Utc>) -> Option<Alert> {
        enum Item<'b> {
            Bar(u32),
            Key(&'static str),
            News(&'b str),
            Roll(&'b str),
        }
        let mut cands: Vec<(DateTime<Utc>, DateTime<Utc>, Item)> = Vec::new();
        for &p in &self.cfg.periods {
            if let Some(b) = self.next_bar(p, after) {
                cands.push((b - self.lead, b, Item::Bar(p)));
            }
        }
        // 关键时点也加上“收盘前提前”的秒数，否则和同一时刻的 K 线收盘会拆成两条，
        // 提前那条之后还会在整点再响一次
        for (k, lead) in &self.keys {
            let total = *lead + self.lead;
            let o = k.next_after(after + total);
            cands.push((o - total, o, Item::Key(k.name)));
        }
        // 同一时刻触发的多条数据都要列出，所以把触发时刻相同的全部加入
        if let Some(first) = self.news.iter().map(|n| n.0).filter(|f| *f > after).min() {
            for (f, t, name) in &self.news {
                if *f == first && !cands.iter().any(|c| matches!(c.2, Item::News(x) if x == name.as_str()) && c.1 == *t) {
                    cands.push((first, *t, Item::News(name)));
                }
            }
        }
        if let Some(first) = self.rolls.iter().map(|r| r.0).filter(|f| *f > after).min() {
            for (f, t, name) in &self.rolls {
                if *f == first && !cands.iter().any(|c| matches!(c.2, Item::Roll(x) if x == name.as_str()) && c.1 == *t) {
                    cands.push((first, *t, Item::Roll(name)));
                }
            }
        }
        let fire_at = cands.iter().map(|c| c.0).min()?;
        let mut alert = Alert {
            fire_at,
            at: fire_at,
            bars: vec![],
            keys: vec![],
            news: vec![],
            rolls: vec![],
            session: String::new(),
            risk: None,
        };
        let mut at = None::<DateTime<Utc>>;
        for (f, o, item) in cands {
            if f != fire_at {
                continue;
            }
            at = Some(at.map_or(o, |a| a.min(o)));
            match item {
                Item::Bar(p) => alert.bars.push(p),
                Item::Key(n) => {
                    if !alert.keys.iter().any(|x| x == n) {
                        alert.keys.push(n.to_string())
                    }
                }
                Item::News(n) => alert.news.push(n.to_string()),
                Item::Roll(n) => {
                    if !alert.rolls.iter().any(|x| x == n) {
                        alert.rolls.push(n.to_string())
                    }
                }
            }
        }
        alert.bars.sort_unstable_by(|a, b| b.cmp(a));
        alert.at = at.unwrap_or(fire_at);
        // K 线收盘看“刚结束的那根”所在时段；关键时点（如开盘/换月）看它开始后的时段
        let probe = if alert.keys.is_empty() && alert.news.is_empty() && alert.rolls.is_empty() {
            alert.at - Duration::seconds(1)
        } else {
            alert.at
        };
        alert.session = session_label(probe);
        alert.risk = self.risk_at(alert.at);
        Some(alert)
    }

    pub fn upcoming(&self, after: DateTime<Utc>, n: usize) -> Vec<Alert> {
        let mut out = Vec::with_capacity(n);
        let mut cur = after;
        while out.len() < n {
            match self.next_one(cur) {
                Some(a) => {
                    cur = a.fire_at;
                    out.push(a);
                }
                None => break,
            }
        }
        out
    }
}

/// 便捷函数：从 `after` 开始的接下来 `n` 次提醒（测试用）。
#[cfg(test)]
pub fn next_alerts(cfg: &Config, cal: &Calendar, after: DateTime<Utc>, n: usize) -> Vec<Alert> {
    Planner::new(cfg, cal, after).upcoming(after, n)
}
