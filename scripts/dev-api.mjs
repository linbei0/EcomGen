// dev:api 包装器：绕开 pnpm --filter 层级直接拉起 tsx watch，并在退出时清理整棵进程树。
// 背景：Windows 上 IDE 停止任务或终端 Ctrl+C 时，终止信号经常传不到 tsx watch 的
// 孙进程（真正监听 8787 的 server），残留孤儿进程导致下次启动 EADDRINUSE。
// 双保险：
// 1) wrapper 收到退出信号时用 taskkill /T /F 强杀进程树（Windows）；
// 2) NODE_OPTIONS 注入 dev-orphan-watchdog.cjs，任何中间父进程被强杀时后代自动退出。
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const apiDir = path.join(projectRoot, "apps", "api");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const watchdog = path.join(scriptDir, "dev-orphan-watchdog.cjs");

// NODE_OPTIONS 会被 tsx 继承并传给 server 子进程，watchdog 因此覆盖整条进程链。
// 路径必须用正斜杠：NODE_OPTIONS 解析器会把 Windows 反斜杠当转义符吃掉。
const watchdogForEnv = `--require "${watchdog.replaceAll("\\", "/")}"`;
const nodeOptions = [process.env.NODE_OPTIONS, watchdogForEnv].filter(Boolean).join(" ");

const child = spawn(process.execPath, [tsxCli, "watch", "--env-file=../../.env", "src/server.ts"], {
  cwd: apiDir,
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

let treeKilled = false;
function killTree() {
  if (treeKilled || child.pid === undefined) return;
  treeKilled = true;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  process.on(signal, () => {
    killTree();
    process.exit(0);
  });
}
process.on("exit", killTree);
