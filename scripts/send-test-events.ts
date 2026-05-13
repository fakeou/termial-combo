import { postEvent } from "../src/client.js";
import { IncomingContextEvent } from "../src/types.js";

const now = new Date().toISOString();
const events: IncomingContextEvent[] = [
  { type: "ai_task_started", source: "test-script", timestamp: now, cwd: process.cwd(), text: "开始一个本地 POC 任务" },
  { type: "ai_prompt_submitted", source: "test-script", cwd: process.cwd(), text: "帮我验证 Warp overlay 可行性" },
  { type: "ai_response_finished", source: "test-script", cwd: process.cwd(), text: "已收到事件，准备显示右上角气泡。" },
  { type: "ai_task_finished", source: "test-script", cwd: process.cwd(), text: "测试任务完成" },
  { type: "hook_error", source: "test-script", text: "这是一条模拟 hook_error，不代表真实失败。", metadata: { simulated: true } },
  {
    type: "warp_window_detected",
    source: "test-script",
    metadata: {
      appName: "Warp",
      bundleId: "dev.warp.Warp-Stable",
      pid: 123,
      title: "mock",
      bounds: { x: 100, y: 80, width: 1200, height: 800 }
    }
  }
];

for (const event of events) {
  await postEvent(event);
  console.log(`sent ${event.type}`);
}
