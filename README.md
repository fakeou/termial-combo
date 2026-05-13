# termial-combo

这是一个从 0 到 1 的可行性 POC：不修改 Warp、不读 terminal buffer、不做 keylogging、不截图 OCR，只验证三件事：

1. macOS 上能否识别当前活跃窗口，尤其是 Warp，并拿到窗口 bounds。
2. 能否从 Claude Code hooks 和 Codex CLI session 日志中抽取 AI 编程上下文事件。
3. 能否把这些事件统一发给本地 daemon，为后续 Warp 右上角贴纸/气泡 overlay 做准备。

第一版是 Warp-first，因为目标体验发生在 Warp 窗口旁边；普通 shell 命令、zsh hooks、Warp 输入框实时内容都不在本阶段范围内。

## 技术方案

- Node.js + TypeScript + pnpm。
- 本地 HTTP daemon 只监听 `127.0.0.1`。
- `active-win` 获取 macOS frontmost app、bundleId、pid、title、bounds。
- Claude Code 使用官方 hooks 输入里的 `UserPromptSubmit` 和 `Stop`。
- Codex CLI 当前走两条路：兼容未来 hook stdin JSON 的脚本，以及已验证的 session JSONL 解析器。
- Overlay 暂未实现，本轮先完成 daemon、窗口检测和 AI 上下文事件流。

## 安装

```bash
pnpm install
```

## 启动 daemon

```bash
pnpm daemon
```

默认配置：

- HTTP: `http://127.0.0.1:39877`
- 事件入口: `POST /events`
- 最近事件查询: `GET /events`
- 健康检查: `GET /health`
- JSONL 日志: `logs/events.jsonl`

可用环境变量：

```bash
PORT=39877
HOST=127.0.0.1
EVENT_LOG_PATH=logs/events.jsonl
RECENT_EVENT_LIMIT=100
WINDOW_POLL_MS=1000
WARP_AI_CONTEXT_ENDPOINT=http://127.0.0.1:39877/events
```

## 事件格式

每条事件会被补齐 `timestamp` 并写入 JSONL。

```json
{
  "type": "ai_prompt_submitted",
  "source": "claude-code",
  "timestamp": "2026-05-13T02:07:38.014Z",
  "cwd": "/repo",
  "sessionId": "abc123",
  "text": "请实现一个 POC",
  "metadata": {
    "hookEventName": "UserPromptSubmit"
  }
}
```

支持的 `type`：

- `ai_prompt_submitted`
- `ai_response_finished`
- `ai_task_started`
- `ai_task_finished`
- `active_app_changed`
- `active_window_changed`
- `warp_window_detected`
- `hook_error`

## curl 测试

先启动 `pnpm daemon`，再运行：

```bash
curl -X POST http://127.0.0.1:39877/events \
  -H 'content-type: application/json' \
  -d '{"type":"ai_prompt_submitted","source":"curl","text":"帮我验证 Warp POC"}'
```

```bash
curl -X POST http://127.0.0.1:39877/events \
  -H 'content-type: application/json' \
  -d '{"type":"ai_response_finished","source":"curl","text":"事件已收到。"}'
```

```bash
curl -X POST http://127.0.0.1:39877/events \
  -H 'content-type: application/json' \
  -d '{"type":"ai_task_started","source":"curl","text":"开始任务"}'
```

```bash
curl -X POST http://127.0.0.1:39877/events \
  -H 'content-type: application/json' \
  -d '{"type":"ai_task_finished","source":"curl","text":"任务完成"}'
```

```bash
curl -X POST http://127.0.0.1:39877/events \
  -H 'content-type: application/json' \
  -d '{"type":"hook_error","source":"curl","text":"模拟 hook 错误","metadata":{"simulated":true}}'
```

```bash
curl -X POST http://127.0.0.1:39877/events \
  -H 'content-type: application/json' \
  -d '{"type":"warp_window_detected","source":"curl","metadata":{"appName":"Warp","bundleId":"dev.warp.Warp-Stable","bounds":{"x":100,"y":80,"width":1200,"height":800}}}'
```

也可以一次发送内置测试事件：

```bash
pnpm events:test
tail -f logs/events.jsonl
```

## Warp active window 检测

daemon 启动后会每秒轮询当前活跃窗口。发生 app/window 变化时发送：

- `active_app_changed`
- `active_window_changed`

如果当前 app 被识别为 Warp，会额外发送：

- `warp_window_detected`

识别规则：

- app name 包含 `Warp`
- 或 bundleId 匹配 `dev.warp.*`

单独检查当前窗口：

```bash
pnpm detect:warp
```

## Electron overlay POC

先启动 daemon：

```bash
pnpm daemon
```

再开另一个终端启动 overlay：

```bash
pnpm overlay
```

这个 overlay 是最小验证版：

- Electron 透明、无边框、always-on-top 小窗。
- 默认不抢焦点。
- 默认鼠标穿透。
- 菜单栏托盘只有一个“退出”菜单项，没有设置界面。
- React renderer 只显示一个白色圆形 `1`。
- 当 daemon 最近的活跃窗口事件是 Warp 时，定位到 Warp 窗口右上角。
- 当当前活跃窗口不是 Warp 时隐藏。
- combo 数字使用横版动作游戏风格：大号斜体数字、厚描边、分段色彩、斜向速度线和电火花；10/30/60/100 combo 会进入更强的颜色段，100+ 固定金黄色；下方展示 C/B/A/SS/SSS 评级，其中 100+ 固定 SSS；2 秒倒计时内透明度逐渐降低，续上 combo 会恢复满不透明；超时后直接隐藏并归 0。

输入连击计数器是显式开启的，因为它需要 macOS Input Monitoring / Accessibility 权限。开启后只监听按键事件发生，不读取字符、不保存 keyCode、不读取 Warp 输入框内容：

```bash
OVERLAY_INPUT_COUNTER=1 pnpm overlay
```

计数规则：

- 仅当 Warp 是活跃窗口时计数。
- 英文/数字/符号等直接输入时，可打印 ASCII 键让数字加 1。
- 空格、方向键、回车、删除等功能键在普通键盘布局下不计数。
- 检测到输入法模式时，拼音/假名等组成过程不计数；空格、回车、数字选词这类常见候选提交键才加 1。
- 2 秒内继续输入会继续累加。
- 超过 2 秒没有输入后归 0，下一次输入从 1 开始。
- 中文输入法场景下，这个 POC 不读取候选词或最终文本，只把常见“完成选词”的按键当作一次 combo；鼠标点选候选词暂不计数。

如果只是想确认小窗本身能不能显示在最近一次 Warp bounds 上，可以临时用强制模式：

```bash
OVERLAY_FORCE_WARP=1 pnpm overlay
```

`OVERLAY_FORCE_WARP=1` 只用于调试显示位置。正式 combo 计数不要带这个变量，否则即使当前活跃窗口不是 Warp，也会使用最近一次 Warp bounds 继续显示。

调试状态会写到：

```bash
cat logs/overlay-state.json
```

成功时会输出类似：

```json
{
  "info": {
    "appName": "Warp",
    "bundleId": "dev.warp.Warp-Stable",
    "pid": 12345,
    "title": "repo",
    "bounds": { "x": 95, "y": 38, "width": 1280, "height": 820 }
  },
  "isWarp": true
}
```

## macOS 权限说明

`active-win` 在 macOS 上可能需要：

- Accessibility：获取前台应用/窗口元数据。
- Screen Recording：某些系统版本上获取窗口标题可能需要；本 POC 不截图、不 OCR。

打开：

`System Settings -> Privacy & Security -> Accessibility`

把运行 `pnpm daemon` 的终端应用、Warp、Codex 或你的 IDE 加进去。权限变更后通常需要重启对应应用。

本机验证结果：已能获取当前 Codex/系统设置窗口的 app name、bundleId、pid、title、bounds；切到 Warp 前台并授权后即可验证 `warp_window_detected`。

## Claude Code hook 配置

Claude Code hooks 官方文档说明 hook 会收到 JSON stdin，`UserPromptSubmit` 输入包含 `session_id`、`transcript_path`、`cwd`、`hook_event_name`、`prompt`，`Stop` 输入包含 `transcript_path` 等字段。参考：[Claude Code hooks reference](https://code.claude.com/docs/en/hooks)。

本 POC 的 Claude 脚本：

```bash
pnpm hook:claude
```

它做的事：

- `UserPromptSubmit`：读取 stdin JSON 的 `prompt`，发送 `ai_prompt_submitted`。
- `Stop`：读取 `transcript_path`，尽量解析最后一条 assistant 文本，发送 `ai_response_finished`，随后发送 `ai_task_finished`。
- transcript 解析失败时发送 `hook_error`。
- 所有错误都被吞掉，不用非 0 exit code 阻塞 Claude Code。

把下面内容合并进 `~/.claude/settings.json` 或项目级 `.claude/settings.json`，并把路径改成你的项目绝对路径：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "pnpm --dir /Users/ousu/Documents/work/termial-combo hook:claude"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "pnpm --dir /Users/ousu/Documents/work/termial-combo hook:claude"
          }
        ]
      }
    ]
  }
}
```

同样的示例也在 `examples/claude-settings.json`。

## Codex CLI hook / log 支持

本机当前 Codex CLI 版本：

```bash
codex --version
# codex-cli 0.130.0
```

`codex --help` 和当前 `~/.codex/config.toml` 未显示稳定 hook 配置入口。因此第一版提供：

1. 兼容 hook stdin JSON 的脚本：

```bash
pnpm hook:codex
```

支持字段：

- `hook_event_name` / `hookEventName`
- `prompt`
- `last_assistant_message`
- `cwd`
- `session_id` / `sessionId`
- `turn_id` / `turnId`

2. Codex session JSONL 解析器：

```bash
pnpm codex:scan ~/.codex/sessions/YYYY/MM/DD/rollout-....jsonl
```

解析器已针对本机观察到的 Codex 0.130 JSONL 结构做了适配：

- `session_meta.payload.id`
- `session_meta.payload.cwd`
- `event_msg.payload.type=user_message`
- `event_msg.payload.type=agent_message`
- `response_item.payload.type=message`
- `payload.role=user|assistant`

注意：Codex Desktop / IDE extension 也会写 session JSONL，但本 POC 只承诺 Codex CLI/session JSONL 路径可用，不承诺 Codex App / IDE extension 的所有事件格式稳定。真实日志里可能同时有 `event_msg` 和 `response_item` 两份同义消息，第一版暂不做严格去重。

## 当前限制

- 不读取 Warp terminal buffer。
- 不读取用户未提交的实时输入。
- 不捕获普通 shell 命令。
- 不做 zsh/shell hook 主链路。
- 不做系统级 keylogging。
- 不截图、不 OCR。
- 不修改 Warp，不做 Warp 插件。
- 不接 LLM，不做回复总结。
- Overlay 本轮未实现。
- `active-win` 已提示包名迁移到 `get-windows`，后续可以替换；当前先保留已验证链路。
- Codex hooks 不是稳定验证路径，Codex session JSONL 才是本轮已跑通路径。

## 已验证

- `pnpm install` 成功。
- `pnpm daemon` 能启动并监听 `127.0.0.1:39877`。
- `pnpm events:test` 能发送事件。
- `logs/events.jsonl` 会写入事件。
- `GET /events` 能返回内存中的最近事件。
- `pnpm detect:warp` 在授权后能获取当前活跃窗口的 app name、bundleId、pid、title、bounds。
- `pnpm codex:scan` 能从当前 Codex session JSONL 中抽取 user/assistant 消息。
- `pnpm test` 和 `pnpm typecheck` 通过。

## 下一步计划

- 用 `get-windows` 替换 deprecated 的 `active-win`，比较权限和字段质量。
- 给 Codex session parser 增加 offset/turnId 去重和增量 tail 模式。
- 把 daemon 合并进 Electron 主进程。
- 做透明、无边框、always-on-top、鼠标穿透的 Electron + React overlay。
- 当 `warp_window_detected` 到来时，把气泡定位到 Warp 窗口右上角。
- 增加隐私模式：敏感 prompt/reply 过滤、长度截断、本地开关。
- 增加中文鼓励/吐槽模板和事件到气泡文案映射。
