// 运行：npm run test:ui（Node 22+ 自带类型剥离）
import { test } from "node:test";
import assert from "node:assert/strict";
import { countdown, hmBJ, periodLabel } from "./format.ts";

test("countdown", () => {
  assert.equal(countdown(0), "00:00");
  assert.equal(countdown(65_000), "01:05");
  assert.equal(countdown(64_001), "01:05");
  assert.equal(countdown(3_725_000), "1:02:05");
});

test("periodLabel", () => {
  assert.equal(periodLabel(15), "15m");
  assert.equal(periodLabel(240), "4h");
});

test("hmBJ", () => {
  assert.equal(hmBJ("2026-10-26T13:30:00Z"), "21:30");
});
