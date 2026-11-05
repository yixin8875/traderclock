//! 全球关键时点。每个时点按所在地时区定义，夏令时由 chrono-tz 自动处理。

use chrono::{DateTime, Datelike, Duration, NaiveTime, Utc, Weekday};
use chrono_tz::{America, Asia, Australia, Europe, Tz};
use serde::Serialize;

use super::tz::{hm, local_to_utc};

#[derive(Clone, Debug, Serialize)]
pub struct KeyPoint {
    pub id: &'static str,
    pub name: &'static str,
    pub group: &'static str,
    #[serde(serialize_with = "ser_tz")]
    pub tz: Tz,
    pub time: NaiveTime,
    #[serde(skip)]
    pub days: &'static [Weekday],
    /// 重要时点：默认开启，时间轴上显示名称。
    pub major: bool,
}

fn ser_tz<S: serde::Serializer>(tz: &Tz, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(tz.name())
}

const WEEKDAYS: &[Weekday] = &[Weekday::Mon, Weekday::Tue, Weekday::Wed, Weekday::Thu, Weekday::Fri];
const SUN: &[Weekday] = &[Weekday::Sun];
const FRI: &[Weekday] = &[Weekday::Fri];
const MON_THU: &[Weekday] = &[Weekday::Mon, Weekday::Tue, Weekday::Wed, Weekday::Thu];

#[allow(clippy::too_many_arguments)]
fn k(
    id: &'static str,
    name: &'static str,
    group: &'static str,
    tz: Tz,
    h: u32,
    m: u32,
    days: &'static [Weekday],
    major: bool,
) -> KeyPoint {
    KeyPoint { id, name, group, tz, time: hm(h, m), days, major }
}

pub fn all() -> Vec<KeyPoint> {
    let (ct, ny, lon) = (America::Chicago, America::New_York, Europe::London);
    vec![
        k("cme_week_open", "CME 周开盘", "周开盘", ct, 17, 0, SUN, true),
        k("sydney_open", "悉尼开盘", "亚盘", Australia::Sydney, 7, 0, WEEKDAYS, false),
        k("tokyo_open", "东京开盘", "亚盘", Asia::Tokyo, 9, 0, WEEKDAYS, false),
        k("hk_open", "港股开盘", "亚盘", Asia::Hong_Kong, 9, 30, WEEKDAYS, false),
        k("frankfurt_open", "法兰克福开盘", "欧盘", Europe::Berlin, 9, 0, WEEKDAYS, false),
        k("london_open", "伦敦开盘", "欧盘", lon, 8, 0, WEEKDAYS, true),
        k("lbma_am", "伦敦金上午定价", "欧盘", lon, 10, 30, WEEKDAYS, false),
        k("comex_gold_open", "COMEX 黄金日盘开盘", "美盘", ny, 8, 20, WEEKDAYS, false),
        k("us_data", "美国数据发布", "美盘", ny, 8, 30, WEEKDAYS, true),
        k("us_open", "美股开盘", "美盘", ny, 9, 30, WEEKDAYS, true),
        k("us_open_30", "开盘 30 分钟", "美盘", ny, 10, 0, WEEKDAYS, false),
        k("lbma_pm", "伦敦金下午定价", "美盘", lon, 15, 0, WEEKDAYS, false),
        k("london_close", "伦敦收盘", "美盘", lon, 16, 0, WEEKDAYS, false),
        k("cme_btc_rr", "CME 比特币参考价", "美盘", lon, 16, 0, WEEKDAYS, false),
        k("comex_gold_close", "COMEX 黄金日盘收盘", "美盘", ny, 13, 30, WEEKDAYS, false),
        k("us_close", "美股收盘", "美盘", ny, 16, 0, WEEKDAYS, true),
        k("cme_daily_halt", "CME 每日休市", "休市", ct, 16, 0, MON_THU, false),
        k("cme_friday_close", "CME 周五收盘", "周收盘", ct, 16, 0, FRI, true),
    ]
}

impl KeyPoint {
    /// 严格晚于 `t` 的下一次发生时刻。
    pub fn next_after(&self, t: DateTime<Utc>) -> DateTime<Utc> {
        let mut d = t.with_timezone(&self.tz).date_naive() - Duration::days(1);
        loop {
            if self.days.contains(&d.weekday()) {
                let u = local_to_utc(self.tz, d, self.time);
                if u > t {
                    return u;
                }
            }
            d += Duration::days(1);
        }
    }
}
