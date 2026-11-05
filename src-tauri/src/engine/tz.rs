//! 时区工具。所有计算都以 UTC 绝对时间为准，本地时间只在定义规则时使用。

use chrono::{DateTime, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::{OffsetComponents, Tz};

/// 某时区的本地日期 + 时间 → UTC。
/// - 夏令时开始时被跳过的时刻（例如 02:30 不存在）顺延 1 小时；
/// - 夏令时结束时重复出现的时刻取较早的一次。
pub fn local_to_utc(tz: Tz, date: NaiveDate, time: NaiveTime) -> DateTime<Utc> {
    let naive = NaiveDateTime::new(date, time);
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(t) => t.with_timezone(&Utc),
        LocalResult::Ambiguous(early, _) => early.with_timezone(&Utc),
        LocalResult::None => tz
            .from_local_datetime(&(naive + Duration::hours(1)))
            .earliest()
            .expect("夏令时跳变不超过 1 小时")
            .with_timezone(&Utc),
    }
}

/// 构造 HH:MM 时间。
pub fn hm(h: u32, m: u32) -> NaiveTime {
    NaiveTime::from_hms_opt(h, m, 0).expect("合法时间")
}

/// 该时区在某一时刻是否处于夏令时。
pub fn is_dst(tz: Tz, t: DateTime<Utc>) -> bool {
    t.with_timezone(&tz).offset().dst_offset() != Duration::zero()
}
