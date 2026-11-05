#!/usr/bin/env node
// 本地发版：递增版本号 → 提交 → 打 tag → 推送。
// tag 推送会触发 GitHub Actions 构建安装包并发布 Release。
// 提交信息带 [skip release]，避免 main 分支推送再触发一次自动发版。
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kind = process.argv[2] ?? "patch";
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("用法：npm run release:patch / release:minor / release:major");
  process.exit(1);
}

const run = (cmd, argv) => execFileSync(cmd, argv, { cwd: root, stdio: "inherit" });

const status = execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim();
if (status) {
  console.error("工作区有未提交的改动，请先提交或暂存后再发版。");
  process.exit(1);
}

run(process.execPath, [join(root, "scripts", "release-version.mjs"), "--bump", kind]);
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tag = `v${version}`;
console.log(`==> 发版 ${tag}`);

run("git", [
  "add",
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
]);
run("git", ["commit", "-m", `chore(release): ${tag} [skip release]`]);
run("git", ["tag", tag]);
run("git", ["push", "origin", "HEAD"]);
run("git", ["push", "origin", tag]);
console.log(`==> 已推送 ${tag}，GitHub Actions 将开始构建并发布 Release`);
