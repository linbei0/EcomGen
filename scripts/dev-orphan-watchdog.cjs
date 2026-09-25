// 防孤儿守护：由 dev-api.mjs 通过 NODE_OPTIONS --require 注入到 dev 进程链的每个 node 进程。
// 当父进程消失（被 IDE 强停任务或异常退出）时自行退出，避免 tsx watch 的
// server 孙进程残留并占住 8787 端口，导致下次启动 EADDRINUSE。
// 只有 dev:api 拉起的进程链会携带此注入，不影响测试与其他 node 进程。
const initialPpid = process.ppid;

function parentAlive() {
  // POSIX 上孤儿进程会被 reparent（ppid 变化），Windows 上孤儿保留原 ppid 但父 pid 已不存在
  if (process.ppid !== initialPpid) return false;
  try {
    process.kill(initialPpid, 0);
    return true;
  } catch {
    return false;
  }
}

const timer = setInterval(() => {
  if (!parentAlive()) process.exit(0);
}, 2000);
timer.unref();
