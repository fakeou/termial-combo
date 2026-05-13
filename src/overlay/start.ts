import { spawn } from "node:child_process";

const vite = spawn("pnpm", ["overlay:vite"], {
  stdio: "inherit",
  shell: true
});

const electron = spawn("pnpm", ["overlay:electron"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    OVERLAY_RENDERER_URL: process.env.OVERLAY_RENDERER_URL ?? "http://127.0.0.1:5173"
  }
});

function shutdown(): void {
  electron.kill();
  vite.kill();
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
