# remind-me

AI 编程工具（ZCode / Claude Code / Codex / Cursor / Trae / WorkBuddy 等）的任务状态通知器：**每条回复结束**、**任务完成**或**中途遇到需要你决策的阻塞点**时，自动发一条企业微信群消息，人不在电脑前也不会错过关键节点。

## 效果

```
💬 ✅ 统计完成：共 12 个文件，3456 行代码。 ⚠️ 有两个文件编码不是 UTF-8，需要你决定要不要转换。
💬 ⚠️ 需要你决策：构建工具二选一，A. vite（快，需迁移配置）；B. webpack（稳，零改动）。回复 A 或 B 后我继续。
```

## 工作原理

一层通用内核，两个触发面：

```
各家工具的 hook 配置 ──┐
                      ├──> scripts/hook.js（自动：回合结束，发回复摘要）
                      │
模型调用 scripts/notify.sh（主动：中途阻塞、用户点名要通知）
```

- `scripts/hook.js` — 通用 hook 内核，自动识别三种事件输入（stdin+transcript_path、命令行参数 JSON、stdin 其他字段），从会话记录提取最后一条回复的摘要发送
- `scripts/notify.sh` — 独立发送脚本，bash + curl 零依赖，任何能跑命令行的 agent 都能调
- `scripts/codex-notify.js` — Codex 专用转发器（Codex 的 `notify` 只能配一个程序，用它兼顾原有通知）

## 快速安装

### 方式 A：对 AI 说一句话（推荐）

把下面这段话直接发给你的 AI 编程工具（ZCode / Claude Code / Codex / WorkBuddy 均可）：

> 请帮我安装 task-notify 企业微信通知技能：克隆 https://github.com/Ego12138/remind-me 到临时目录，阅读其中的 INSTALL-AI.md 并严格按它执行。如果我没有企业微信机器人 key，先引导我创建后再继续。

AI 会自动完成全部步骤：下载 → 安装内核和技能 → 向你索要 key → 检测你机器上装了哪些工具并自动接入 → 发送测试消息。

### 方式 B：一键脚本（自己跑）

```bash
git clone https://github.com/Ego12138/remind-me && node remind-me/install.js
# 已有 key 可免交互: node remind-me/install.js --key <你的key>
```

### 方式 C：手动安装

见下方「快速开始」和「接入你的 agent 工具」。

## 快速开始

### 1. 拿到企业微信机器人 key

企业微信 App（个人可免费注册）→ 建一个群 → 群设置 → 群机器人（新版本叫「消息推送」，需在管理后台 应用管理 → 消息推送 开权限）→ 新建 → 复制 Webhook 地址里 `key=` 后面的那串。

### 2. 写入配置

```bash
mkdir -p ~/.agent-notify
echo 'WECOM_WEBHOOK_KEY=你的key' > ~/.agent-notify/task-notify.conf
```

### 3. 测试发送

```bash
bash scripts/notify.sh "✅ task-notify 配置成功"
```

收到 `{"errcode":0,"errmsg":"ok"}` 且群里看到消息即成功。

### 4. 接入你的 agent 工具（每条回复自动通知）

把下面片段里的 `hook.js` 换成你机器上的**绝对路径**（建议把本仓库 clone 到固定位置，如 `~/.agent-notify/task-notify`）。

**ZCode**（`~/.zcode/cli/config.json`，注意必须 `enabled: true`）：

```json
{
  "hooks": {
    "enabled": true,
    "events": {
      "Stop": [
        { "hooks": [ { "type": "process", "command": "node", "args": ["C:/Users/你/.agent-notify/task-notify/scripts/hook.js"], "timeoutMs": 15000 } ] }
      ]
    }
  }
}
```

**Claude Code**（`~/.claude/settings.json`）：

```json
{
  "hooks": {
    "Stop": [
      { "matcher": "", "hooks": [ { "type": "command", "command": "node C:/Users/你/.agent-notify/task-notify/scripts/hook.js" } ] }
    ]
  }
}
```

**Codex CLI**（`~/.codex/config.toml`）：

```toml
notify = [ "node", "C:/Users/你/.agent-notify/task-notify/scripts/codex-notify.js" ]
```

> 若你原来已配置过 `notify`（Codex 只允许一个），把它填到 conf 的 `CODEX_PREVIOUS_NOTIFY=<原程序路径>`，转发器会先调用它再发企业微信。

**Cursor**（`~/.cursor/hooks.json`，不生效就复制到项目的 `.cursor/hooks.json`）：

```json
{
  "version": 1,
  "hooks": {
    "afterAgentResponse": [
      { "comment": "回复结束发企业微信通知", "command": "node C:/Users/你/.agent-notify/task-notify/scripts/hook.js" }
    ]
  }
}
```

**Trae**（项目级 `.trae/hooks.json`，模板见 [examples/trae-hooks.json](examples/trae-hooks.json)）。

**WorkBuddy / CodeBuddy Code**（`~/.workbuddy/settings.json`，格式同 Claude Code 的 hooks 块）。

**其他工具**：有 hook/notify 机制的，把配置指向 `scripts/hook.js` 即可；没有 hook 但能跑命令+能注入规则（rules/系统提示词）的，在规则里写"每次回复结束后执行 `bash scripts/notify.sh '回复摘要'`"实现半自动通知；纯聊天类 App（无 hook、无命令执行）无法接入。

## 限制

- 企业微信 webhook 限频 **20 条/分钟**，无每日总量限制，免费
- 单条消息上限约 2000 字节（约 660 汉字），hook 内核自动截断到 300 字
- 各工具 hook 配置均为**会话启动时加载**，改完配置需重启/新开会话生效

## 安全说明

`task-notify.conf` 里的 webhook key 等同于"谁能往你群里发消息"的凭据，已在 `.gitignore` 中排除，请勿提交或外传。本仓库所有代码不包含任何密钥。

## 已知踩过的坑（Windows）

- bash 调用原生 `curl.exe` 时，命令行参数会被按系统 ANSI 代码页（GBK）转码导致中文乱码——本项目所有消息都走 **stdin/管道** 传输，不经命令行参数
- Windows 下 node 同步读 stdin 管道会得到空内容——`hook.js` 使用异步事件流读取
