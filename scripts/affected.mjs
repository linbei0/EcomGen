#!/usr/bin/env node
/**
 * 按改动影响面选择要执行的工作区包，替代"改几行也全量跑一遍"。
 *
 * 选择集合由 git diff 加 pnpm 工作区依赖图决定，因此判断依据是"改动能到达哪些包"，
 * 而不是改动行数：一个字符的共享契约改动比几十行 UI 改动的影响面更大。
 *
 * 三处必须由本脚本处理、无法交给 pnpm 单条过滤表达的行为：
 * 1. 根包必须排除。根 package.json 的 test/build 是递归入口，而 pnpm-lock.yaml 等
 *    根级文件一进 diff 就会选中根包，结果是静默地把范围放大成全量。
 * 2. 排除根包又会使根级共享配置的改动丢失放大语义，所以这类文件必须显式升级为全量。
 * 3. 基线不可达时 pnpm 会静默改变选择结果，这里改为显式失败。
 *
 * 用法：node scripts/affected.mjs <test|build> [--list]
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_PACKAGE_NAME = "ecomgen";

/** 影响面无法从依赖图推导的根级共享配置：改动其一即升级为全量。 */
const SHARED_ROOT_PATTERNS = [
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^package\.json$/,
  /^tsconfig\.base\.json$/,
  /^Dockerfile$/,
  /^docker-compose\.yml$/,
  /^\.dockerignore$/,
  /^scripts\//,
  /^\.github\//,
  /^openapi(\.yaml|\/)/,
];

/**
 * 测试关心改动会不会打破调用方，所以要带上依赖方（`...[ref]`）；
 * 构建关心上游是否已产出 dist，所以要带上依赖（`[ref]...`）。方向取反会得到
 * 一个"看起来被裁剪、实际漏掉关键包"的结果。
 */
const DIRECTIONS = {
  test: (ref) => `...[${ref}]`,
  build: (ref) => `[${ref}]...`,
};

/**
 * 作用域策略只能通过命令行 flag 传入，且每个 flag 只接一个 pattern。
 * 已实测 pnpm 11.19.0：逗号拼接的多个 pattern 会被静默忽略（等于没有过滤），
 * 写进 pnpm-workspace.yaml 或 .npmrc 同样不生效，而 PNPM_CONFIG_TEST_PATTERN
 * 环境变量形式会让过滤结果变成 0 个包——最后一种最危险，因为命令仍然成功退出。
 */
const TEST_FILES = ["**/*.test.ts", "**/*.test.tsx"];
const IGNORED_FILES = ["**/*.md", "docs/**"];

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(bin, args, options = {}) {
  return execFileSync(bin, args, { cwd: REPO_ROOT, encoding: "utf8", ...options });
}

/**
 * Windows 上 pnpm 是 .cmd 垫片，Node 22 起 execFileSync 直接调用会抛 EINVAL
 * （CVE-2024-27980 的修复禁止对 .cmd/.bat 隐式 shell），因此优先复用 pnpm 注入的
 * npm_execpath 走纯 JS 入口；只有在直接 node 调用时才退回带 shell 的垫片。
 */
function runPnpm(args, options = {}) {
  const execPath = process.env.npm_execpath;
  if (execPath && /\.(?:c?js|mjs)$/.test(execPath)) {
    return run(process.execPath, [execPath, ...args], options);
  }
  return run(pnpmBin, args, { shell: process.platform === "win32", ...options });
}

function fail(message) {
  console.error(`affected: ${message}`);
  process.exit(1);
}

/**
 * shell 回退路径下参数会被拼接为命令行，因此限制 ref 字符集做纵深防护。
 * git 允许分号等字符出现在合法 ref 名中，不能只依赖 rev-parse 校验。
 */
const SAFE_REF = /^[A-Za-z0-9._/~^-]+$/;

/** 基线按 ECOMGEN_BASE_REF → origin/main → main 依次探测，全部不可达时显式报错。 */
function resolveBaseRef() {
  const candidates = [process.env.ECOMGEN_BASE_REF, "origin/main", "main"].filter(Boolean);
  for (const ref of candidates) {
    if (!SAFE_REF.test(ref)) fail(`基线 ref 含非法字符：${ref}`);
    try {
      run("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { stdio: "ignore" });
      return ref;
    } catch {
      // 探测下一个候选；不可达的基线会让 pnpm 静默改变选择结果，不能容忍。
    }
  }
  return fail(`无法解析基线 ref（已尝试 ${candidates.join("、")}），可用 ECOMGEN_BASE_REF 显式指定`);
}

function changedFiles(ref) {
  const output = run("git", ["diff", "--name-only", ref]);
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** 把本脚本用到的 glob 子集（`**/`、`**`、`*`）转为正则，`**/` 需能匹配零层目录。 */
function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(file));
}

const task = process.argv[2];
const listOnly = process.argv.includes("--list");
if (!task || !(task in DIRECTIONS)) fail(`用法：node scripts/affected.mjs <${Object.keys(DIRECTIONS).join("|")}> [--list]`);

const baseRef = resolveBaseRef();
const changed = changedFiles(baseRef);
const sharedChanges = changed.filter((file) => SHARED_ROOT_PATTERNS.some((pattern) => pattern.test(file)));

if (changed.length === 0) {
  console.log(`affected: 相对 ${baseRef} 无改动，跳过 ${task}`);
  process.exit(0);
}

// 根级共享配置改动后，依赖图不再能界定影响范围，退回全量而不是假装范围化。
if (sharedChanges.length > 0) {
  console.log(`affected: 根级共享配置已改动（${sharedChanges.join("、")}），影响面无法从依赖图推导，执行全量 ${task}`);
  if (listOnly) process.exit(0);
  runPnpm(["-r", "run", task], { stdio: "inherit" });
  process.exit(0);
}

const scopeArgs = [
  ...IGNORED_FILES.flatMap((pattern) => ["--changed-files-ignore-pattern", pattern]),
  // 只改测试文件时不必验证依赖方：测试不参与其它包的运行时行为。
  ...(task === "test" ? TEST_FILES.flatMap((pattern) => ["--test-pattern", pattern]) : []),
];
const filterArgs = [`--filter`, DIRECTIONS[task](baseRef), `--filter`, `!${ROOT_PACKAGE_NAME}`];
const selected = JSON.parse(runPnpm(["list", ...filterArgs, ...scopeArgs, "--recursive", "--depth", "-1", "--json"]));
const names = selected.map((entry) => entry.name).filter(Boolean);

if (names.length === 0) {
  // 空的选中集合有两种来源：改动确实不涉及任何包（正常），或者过滤器悄悄失效。
  // 后者会让"没跑测试"表现为成功，因此必须区分而不是一律跳过。
  const workspaceFiles = changed.filter((file) => /^(?:apps|packages)\//.test(file) && !matchesAny(file, IGNORED_FILES));
  if (workspaceFiles.length > 0) {
    fail(`${workspaceFiles.length} 个工作区文件有改动却未选中任何包，过滤结果不可信：${workspaceFiles.slice(0, 5).join("、")}`);
  }
  console.log(`affected: ${changed.length} 个文件改动均不属于工作区包，跳过 ${task}`);
  process.exit(0);
}

console.log(`affected: 基线 ${baseRef}，改动 ${changed.length} 个文件，选中 ${names.length} 个包：`);
for (const name of names) console.log(`  - ${name}`);
if (listOnly) process.exit(0);

runPnpm([...filterArgs, ...scopeArgs, "run", task], { stdio: "inherit" });
