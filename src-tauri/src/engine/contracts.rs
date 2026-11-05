//! CME 期货合约换月/到期日计算。
//!
//! 这里只处理常见品种的标准规则；实际换月日可以在设置里手动覆盖。
//! 规则不依赖网络，按日期计算，跨年、闰年和夏令时都不需要额外数据。

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, Utc, Weekday};
use chrono_tz::{America, Tz};
use serde::{Deserialize, Serialize};

use super::tz::{hm, local_to_utc};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContractId {
    Es,
    Nq,
    Gc,
    Btc,
}

impl ContractId {
    pub const ALL: [ContractId; 4] = [ContractId::Es, ContractId::Nq, ContractId::Gc, ContractId::Btc];

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "es" => Some(ContractId::Es),
            "nq" => Some(ContractId::Nq),
            "gc" => Some(ContractId::Gc),
            "btc" => Some(ContractId::Btc),
            _ => None,
        }
    }

    pub fn meta(self) -> ContractMeta {
        match self {
            ContractId::Es => ContractMeta {
                name: "ES 标普 500",
                root: "ES",
                months: EQUITY_MONTHS,
                tz: America::New_York,
                time: hm(9, 30),
                rule: RollRule::EquityIndex,
            },
            ContractId::Nq => ContractMeta {
                name: "NQ 纳斯达克 100",
                root: "NQ",
                months: EQUITY_MONTHS,
                tz: America::New_York,
                time: hm(9, 30),
                rule: RollRule::EquityIndex,
            },
            ContractId::Gc => ContractMeta {
                name: "GC 黄金",
                root: "GC",
                months: GOLD_MONTHS,
                tz: America::New_York,
                time: hm(8, 20),
                rule: RollRule::Gold,
            },
            ContractId::Btc => ContractMeta {
                name: "BTC 比特币",
                root: "BTC",
                months: BTC_MONTHS,
                tz: America::Chicago,
                time: hm(16, 0),
                rule: RollRule::Bitcoin,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RollRule {
    /// 股指期货：第三个周五到期，前一周周四换月。
    EquityIndex,
    /// COMEX 黄金：交割月前一个月的最后一个工作日换月。
    Gold,
    /// CME 比特币：合约月最后一个周五到期并换月。
    Bitcoin,
}

#[derive(Clone, Copy, Debug)]
pub struct ContractMeta {
    pub name: &'static str,
    pub root: &'static str,
    pub months: &'static [u32],
    pub tz: Tz,
    pub time: NaiveTime,
    rule: RollRule,
}

const EQUITY_MONTHS: &[u32] = &[3, 6, 9, 12];
const GOLD_MONTHS: &[u32] = &[2, 4, 6, 8, 10, 12];
const BTC_MONTHS: &[u32] = &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

#[derive(Clone, Debug, Serialize)]
pub struct ContractEvent {
    pub date: NaiveDate,
    /// roll = 换月，expiry = 到期
    pub kind: &'static str,
    pub code: String,
    pub label: String,
}

#[derive(Clone, Debug)]
pub struct RollInfo {
    pub current_code: String,
    pub next_code: String,
    pub standard_roll_date: NaiveDate,
    pub roll_date: NaiveDate,
    pub expiry_date: NaiveDate,
    pub roll_at: DateTime<Utc>,
    pub standard_roll_at: DateTime<Utc>,
}

fn is_business_day(d: NaiveDate) -> bool {
    !matches!(d.weekday(), Weekday::Sat | Weekday::Sun)
}

fn last_day_of_month(year: i32, month: u32) -> NaiveDate {
    let (ny, nm) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    NaiveDate::from_ymd_opt(ny, nm, 1).expect("月份合法") - Duration::days(1)
}

fn third_friday(year: i32, month: u32) -> NaiveDate {
    let first = NaiveDate::from_ymd_opt(year, month, 1).expect("月份合法");
    let offset = (Weekday::Fri.num_days_from_monday() + 7 - first.weekday().num_days_from_monday()) % 7;
    first + Duration::days(offset as i64 + 14)
}

fn last_friday(year: i32, month: u32) -> NaiveDate {
    let mut d = last_day_of_month(year, month);
    while d.weekday() != Weekday::Fri {
        d -= Duration::days(1);
    }
    d
}

fn last_business_day(year: i32, month: u32) -> NaiveDate {
    let mut d = last_day_of_month(year, month);
    while !is_business_day(d) {
        d -= Duration::days(1);
    }
    d
}

fn third_last_business_day(year: i32, month: u32) -> NaiveDate {
    let mut d = last_day_of_month(year, month);
    let mut seen = 0;
    loop {
        if is_business_day(d) {
            seen += 1;
            if seen == 3 {
                return d;
            }
        }
        d -= Duration::days(1);
    }
}

fn previous_month(year: i32, month: u32) -> (i32, u32) {
    if month == 1 {
        (year - 1, 12)
    } else {
        (year, month - 1)
    }
}

fn month_code(month: u32) -> char {
    match month {
        1 => 'F',
        2 => 'G',
        3 => 'H',
        4 => 'J',
        5 => 'K',
        6 => 'M',
        7 => 'N',
        8 => 'Q',
        9 => 'U',
        10 => 'V',
        11 => 'X',
        12 => 'Z',
        _ => '?',
    }
}

/// 例如 ES + 2026-12 → ESZ6
pub fn contract_code(root: &str, year: i32, month: u32) -> String {
    format!("{root}{}{}", month_code(month), year.rem_euclid(10))
}

fn roll_date(meta: &ContractMeta, year: i32, month: u32) -> NaiveDate {
    match meta.rule {
        RollRule::EquityIndex => third_friday(year, month) - Duration::days(8),
        RollRule::Gold => {
            let (y, m) = previous_month(year, month);
            last_business_day(y, m)
        }
        RollRule::Bitcoin => last_friday(year, month),
    }
}

fn expiry_date(meta: &ContractMeta, year: i32, month: u32) -> NaiveDate {
    match meta.rule {
        RollRule::EquityIndex => third_friday(year, month),
        RollRule::Gold => third_last_business_day(year, month),
        RollRule::Bitcoin => last_friday(year, month),
    }
}

fn next_standard(meta: &ContractMeta, now: DateTime<Utc>) -> Option<(i32, u32, NaiveDate)> {
    for year in now.year().saturating_sub(1)..=now.year().saturating_add(3) {
        for &month in meta.months {
            let date = roll_date(meta, year, month);
            let at = local_to_utc(meta.tz, date, meta.time);
            if at > now {
                return Some((year, month, date));
            }
        }
    }
    None
}

fn next_contract_month(meta: &ContractMeta, year: i32, month: u32) -> (i32, u32) {
    let idx = meta.months.iter().position(|&m| m == month).unwrap_or(0);
    if idx + 1 < meta.months.len() {
        (year, meta.months[idx + 1])
    } else {
        (year + 1, meta.months[0])
    }
}

/// 当前合约和下一次换月。`override_date` 只影响当前合约的换月提醒。
pub fn next_roll(id: ContractId, now: DateTime<Utc>, override_date: Option<NaiveDate>) -> Option<RollInfo> {
    let meta = id.meta();
    let (year, month, standard_date) = next_standard(&meta, now)?;
    let standard_at = local_to_utc(meta.tz, standard_date, meta.time);
    let override_at = override_date
        .filter(|d| *d >= now.date_naive())
        .map(|d| (d, local_to_utc(meta.tz, d, meta.time)))
        .filter(|(_, at)| *at > now);
    let (roll_date, roll_at) = override_at.unwrap_or((standard_date, standard_at));
    let (ny, nm) = next_contract_month(&meta, year, month);

    Some(RollInfo {
        current_code: contract_code(meta.root, year, month),
        next_code: contract_code(meta.root, ny, nm),
        standard_roll_date: standard_date,
        roll_date,
        expiry_date: expiry_date(&meta, year, month),
        roll_at,
        standard_roll_at: standard_at,
    })
}

/// 未来约 13 个月的换月/到期事件，供日历和合约页使用。
pub fn events(id: ContractId, now: DateTime<Utc>, override_date: Option<NaiveDate>) -> Vec<ContractEvent> {
    let meta = id.meta();
    let Some((current_year, current_month, _)) = next_standard(&meta, now) else {
        return vec![];
    };
    let today = now.date_naive();
    let from = today - Duration::days(31);
    let to = today + Duration::days(400);
    let mut out = Vec::new();

    for year in current_year.saturating_sub(1)..=current_year.saturating_add(2) {
        for &month in meta.months {
            let standard = roll_date(&meta, year, month);
            let is_current = year == current_year && month == current_month;
            let effective = if is_current {
                override_date.filter(|d| *d >= today).unwrap_or(standard)
            } else {
                standard
            };
            let expiry = expiry_date(&meta, year, month);
            let code = contract_code(meta.root, year, month);

            if effective >= from && effective <= to {
                let (kind, label) = if effective == expiry {
                    ("roll", format!("{} 换月/到期", meta.root))
                } else {
                    ("roll", format!("{} 换月", meta.root))
                };
                out.push(ContractEvent { date: effective, kind, code: code.clone(), label });
            }
            if expiry != effective && expiry >= from && expiry <= to {
                out.push(ContractEvent { date: expiry, kind: "expiry", code, label: format!("{} 到期", meta.root) });
            }
        }
    }

    out.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.kind.cmp(b.kind)).then_with(|| a.code.cmp(&b.code)));
    out.dedup_by(|a, b| a.date == b.date && a.kind == b.kind && a.code == b.code);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn utc(y: i32, m: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, mi, 0).unwrap()
    }

    #[test]
    fn contract_codes_use_cme_month_letters() {
        assert_eq!(contract_code("ES", 2026, 12), "ESZ6");
        assert_eq!(contract_code("NQ", 2027, 3), "NQH7");
        assert_eq!(contract_code("GC", 2026, 2), "GCG6");
        assert_eq!(contract_code("BTC", 2026, 1), "BTCF6");
    }

    #[test]
    fn es_rolls_the_thursday_before_third_friday() {
        assert_eq!(third_friday(2026, 12), date(2026, 12, 18));
        let info = next_roll(ContractId::Es, utc(2026, 12, 9, 12, 0), None).unwrap();
        assert_eq!(info.current_code, "ESZ6");
        assert_eq!(info.next_code, "ESH7");
        assert_eq!(info.standard_roll_date, date(2026, 12, 10));
        assert_eq!(info.expiry_date, date(2026, 12, 18));
        assert_eq!(info.roll_at, utc(2026, 12, 10, 14, 30));
    }

    #[test]
    fn after_roll_the_next_quarter_is_current() {
        let info = next_roll(ContractId::Nq, utc(2026, 12, 11, 0, 0), None).unwrap();
        assert_eq!(info.current_code, "NQH7");
        assert_eq!(info.next_code, "NQM7");
        assert_eq!(info.standard_roll_date, date(2027, 3, 11));
        assert_eq!(info.expiry_date, date(2027, 3, 19));
    }

    #[test]
    fn gold_rolls_at_the_end_of_the_prior_month() {
        let info = next_roll(ContractId::Gc, utc(2026, 11, 1, 0, 0), None).unwrap();
        assert_eq!(info.current_code, "GCZ6");
        assert_eq!(info.standard_roll_date, date(2026, 11, 30));
        assert_eq!(info.expiry_date, date(2026, 12, 29));
    }

    #[test]
    fn bitcoin_rolls_on_the_last_friday() {
        let info = next_roll(ContractId::Btc, utc(2026, 12, 1, 0, 0), None).unwrap();
        assert_eq!(info.current_code, "BTCZ6");
        assert_eq!(info.standard_roll_date, date(2026, 12, 25));
        assert_eq!(info.expiry_date, date(2026, 12, 25));
        assert_eq!(info.next_code, "BTCF7");
    }

    #[test]
    fn override_changes_only_the_current_roll() {
        let info = next_roll(ContractId::Es, utc(2026, 12, 1, 0, 0), Some(date(2026, 12, 8))).unwrap();
        assert_eq!(info.current_code, "ESZ6");
        assert_eq!(info.roll_date, date(2026, 12, 8));
        assert_eq!(info.standard_roll_date, date(2026, 12, 10));
    }

    #[test]
    fn events_include_roll_and_expiry_for_calendar() {
        let list = events(ContractId::Es, utc(2026, 11, 1, 0, 0), None);
        assert!(list.iter().any(|e| e.date == date(2026, 12, 10) && e.kind == "roll"));
        assert!(list.iter().any(|e| e.date == date(2026, 12, 18) && e.kind == "expiry"));
    }
}
