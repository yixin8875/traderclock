//! 时段与调度引擎：纯计算，不依赖 Tauri，便于单元测试。

pub mod config;
pub mod contracts;
pub mod holidays;
pub mod keys;
pub mod market;
pub mod news;
pub mod schedule;
pub mod tz;

#[cfg(test)]
mod tests;
