#!/usr/bin/env node
// 统一维护版本号：package.json、tauri.conf.json、Cargo.toml、Cargo.lock 必须一致。
// 用法：
//   node scripts/release-version.mjs --print
//   node scripts/release-version.mjs --set 0.2.0
//   node scripts/release-version.mjs --bump [patch|minor|major]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  package: join(root, "package.json"),
  packageLock: join(root, "package-lock.json"),
  tauri: join(root, "src-tauri", "tauri.conf.json"),
  cargo: join(root, "src-tauri", "Cargo.toml"),
  lock: join(root, "src-tauri", "Cargo.lock"),
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function readCurrent() {
  return JSON.parse(readFileSync(files.package, "utf8")).version;
}

function nextVersion(current, kind) {
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`当前版本号不是 x.y.z 格式：${current}`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function writePackage(version) {
  const json = JSON.parse(readFileSync(files.package, "utf8"));
  json.version = version;
  writeFileSync(files.package, `${JSON.stringify(json, null, 2)}\n`);
}

function writePackageLock(version) {
  try {
    const json = JSON.parse(readFileSync(files.packageLock, "utf8"));
    json.version = version;
    if (json.packages?.[""]) json.packages[""].version = version;
    writeFileSync(files.packageLock, `${JSON.stringify(json, null, 2)}\n`);
  } catch {
    // 没有锁文件时跳过，npm install 会重新生成
  }
}

function writeTauri(version) {
  const json = JSON.parse(readFileSync(files.tauri, "utf8"));
  json.version = version;
  writeFileSync(files.tauri, `${JSON.stringify(json, null, 2)}\n`);
}

function writeCargo(version) {
  const text = readFileSync(files.cargo, "utf8");
  const pkg = /\[package\][\s\S]*?(?=\n\[)/.exec(text);
  if (!pkg) throw new Error("Cargo.toml 里找不到 [package] 段");
  const updated = pkg[0].replace(/^version = "[^"]*"$/m, `version = "${version}"`);
  writeFileSync(files.cargo, text.replace(pkg[0], updated));
}

function writeLock(version) {
  let text;
  try {
    text = readFileSync(files.lock, "utf8");
  } catch {
    return; // 还没生成锁文件时由 cargo 自己创建
  }
  const updated = text.replace(
    /(\[\[package\]\]\nname = "tradeclock"\nversion = ")[^"]*(")/,
    `$1${version}$2`,
  );
  if (updated !== text) writeFileSync(files.lock, updated);
}

const args = process.argv.slice(2);
const mode = args[0] ?? "--print";
let version;

if (mode === "--print") {
  version = readCurrent();
  console.log(version);
  process.exit(0);
} else if (mode === "--set") {
  version = args[1];
  if (!version || !SEMVER.test(version)) throw new Error("--set 需要 x.y.z 形式的版本号");
} else if (mode === "--bump") {
  const kind = args[1] ?? "patch";
  if (!["patch", "minor", "major"].includes(kind)) throw new Error(`未知的递增类型：${kind}`);
  version = nextVersion(readCurrent(), kind);
} else {
  throw new Error(`未知参数：${mode}`);
}

writePackage(version);
writePackageLock(version);
writeTauri(version);
writeCargo(version);
writeLock(version);
console.log(version);
