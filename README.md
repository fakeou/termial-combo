# termial-combo

Warp-first combo overlay POC.

它会在 macOS 上识别当前活跃窗口是否是 Warp，并在 Warp 右上角显示一个动作游戏风格的连击 UI。输入越连续，combo 越高；50 combo 后进入金色 SSS，并触发礼花效果。

本项目不读取 Warp terminal buffer，不读取输入框内容，不截图 OCR，不修改 Warp，也不做 Warp 插件。输入计数只监听按键事件是否发生，用来做连击效果。

## 功能

- 本地 daemon 监听 `127.0.0.1:39877`
- 自动检测当前活跃 app/window
- Warp 活跃时显示 overlay，非 Warp 时隐藏
- combo 评级：C 灰、B 蓝、A 紫、S 红、SS 烈焰、SSS 金
- 50+ combo 触发 SSS 礼花
- 菜单栏入口可切换 combo 样式和连击延续时间
- 支持 Claude Code / Codex CLI 事件 hook POC

## 安装

需要 Node.js 20+ 和 pnpm。

```bash
pnpm install
```

## 启动

先启动 daemon：

```bash
pnpm daemon
```

再开一个终端启动 overlay：

```bash
OVERLAY_INPUT_COUNTER=1 pnpm overlay
```

启动后，菜单栏会出现 `⚡`。点击它可以：

- 切换样式：`DNF Arcade`、`Neon Blade`、`Gold Burst`
- 切换连击延续时间：`1.5 秒`、`2 秒`、`2.5 秒`、`3 秒`
- 退出应用

## 使用

1. 保持 `pnpm daemon` 运行。
2. 保持 `OVERLAY_INPUT_COUNTER=1 pnpm overlay` 运行。
3. 切到 Warp。
4. 开始输入。

combo 规则：

- 只有 Warp 是活跃窗口时才计数。
- 英文、数字、符号等直接输入会增加 combo。
- 普通空格、方向键、删除等功能键不计数。
- 输入法组合过程中不计数；空格、回车、数字选词等常见提交键会记为一次 combo。
- 超过设定时间没有继续输入，combo 隐藏并归 0。

调试当前 overlay 状态：

```bash
cat logs/overlay-state.json
```

查看事件日志：

```bash
tail -f logs/events.jsonl
```

## macOS 权限

窗口检测和输入计数可能需要授权：

- Accessibility
- Input Monitoring
- 某些 macOS 版本可能还需要 Screen Recording 才能拿到窗口标题

打开：

```text
System Settings -> Privacy & Security
```

把启动项目的终端应用加入对应权限列表。授权后通常需要重启终端、daemon 和 overlay。

## 本地事件 API

daemon 默认地址：

```text
http://127.0.0.1:39877
```

常用接口：

- `POST /events`
- `GET /events`
- `GET /health`

发送测试事件：

```bash
curl -X POST http://127.0.0.1:39877/events \
  -H 'content-type: application/json' \
  -d '{"type":"ai_prompt_submitted","source":"curl","text":"hello combo"}'
```

发送内置测试事件：

```bash
pnpm events:test
```

单独检查当前活跃窗口：

```bash
pnpm detect:warp
```

## Claude / Codex POC

Claude Code hook 脚本：

```bash
pnpm hook:claude
```

示例配置在：

```text
examples/claude-settings.json
```

Codex hook 兼容脚本：

```bash
pnpm hook:codex
```

Codex session JSONL 扫描：

```bash
pnpm codex:scan /path/to/session.jsonl
```

## Prompt Sticker Rules

daemon 会监听 Claude Code hook 发送的用户 prompt，也会默认监听 Codex 本地历史文件 `~/.codex/history.jsonl`。命中规则后，会在 combo 下方临时显示 emoji、图片、GIF 或 MP4 贴纸。

Codex 监听不依赖 hook。daemon 启动时会从 `history.jsonl` 文件末尾开始 tail，只处理启动后的新增 prompt，不会重放历史记录。

可以用环境变量调整 Codex 监听：

```bash
CODEX_HISTORY_PATH=/path/to/history.jsonl pnpm daemon
CODEX_HISTORY_TAIL=0 pnpm daemon
CODEX_HISTORY_POLL_MS=50 pnpm daemon
```

overlay 默认会在 Warp 前台按 Return / Keypad Enter 时请求 daemon 立即检查一次 Codex history，用来降低贴纸触发延迟。这个行为需要启动 overlay 的进程拥有 macOS Input Monitoring / Accessibility 权限；如果权限不可用，daemon 的轮询仍会兜底。

```bash
OVERLAY_CODEX_SCAN_ON_ENTER=0 pnpm overlay
OVERLAY_CODEX_SCAN_URL=http://127.0.0.1:39877/codex/scan pnpm overlay
```

默认配置路径：

```text
config/sticker-rules.json
```

可以用环境变量覆盖：

```bash
STICKER_RULES_PATH=/path/to/rules.json pnpm daemon
APP_CONFIG_PATH=/path/to/rules.json pnpm daemon
```

规则会匹配中文关键词。`durationMs` 最长为 `5000`，超过会被 clamp 到 `5000`。打包后的菜单栏里可以打开编辑器，用图形界面调整 combo 样式、预览效果、配置关键词规则和上传贴纸素材。

retry emoji 示例：

```json
{
  "rules": [
    {
      "id": "retry-emoji",
      "enabled": true,
      "keywords": ["不对", "不行", "重新来"],
      "asset": {
        "type": "emoji",
        "value": "😵"
      },
      "durationMs": 2000
    }
  ]
}
```

GIF 示例：

```json
{
  "rules": [
    {
      "id": "boom-gif",
      "enabled": true,
      "keywords": ["爆炸", "炸了"],
      "asset": {
        "type": "gif",
        "path": "assets/stickers/boom.gif"
      },
      "durationMs": 3000
    }
  ]
}
```

循环贴纸示例：

```json
{
  "rules": [
    {
      "id": "stuck-cycle",
      "enabled": true,
      "keywords": ["卡住", "无响应"],
      "displayMode": "cycle",
      "cycleIntervalMs": 700,
      "assets": [
        {
          "type": "emoji",
          "value": "😵"
        },
        {
          "type": "gif",
          "path": "assets/stickers/stuck.gif"
        }
      ],
      "durationMs": 3000
    }
  ]
}
```

## 开发检查

```bash
pnpm test
pnpm typecheck
pnpm build:electron
```
