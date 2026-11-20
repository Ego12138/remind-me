# INSTALL-AI.md — task-notify 安装手册（供 AI agent 执行）

用户希望安装"任务状态企业微信通知"技能。请严格按本手册执行，遇到需要用户提供的凭据时向用户索要。安装器脚本 `install.js` 已自动化大部分步骤，优先使用它；失败时再按下面第 4 步手动执行。

## 1. 前置检测

- `node -v`：需要 node ≥ 16（hook 内核和安装器都依赖）。
- `git --version`：用于克隆仓库；没有 git 时改用 `curl -L <仓库tarball地址>` 解压。
- 已装哪些 agent 工具：检查 `~/.zcode`、`~/.claude`、`~/.codex`、`~/.cursor`、`~/.workbuddy` 哪些目录存在。

## 2. 获取仓库

```bash
git clone --depth 1 https://github.com/Ego12138/remind-me /tmp/remind-me
```

克隆被重置（国内网络常见）时，依次尝试本机常见混合代理端口（7890、7897、10808、10809、2080）：

```bash
HTTPS_PROXY=http://127.0.0.1:7890 git clone --depth 1 https://github.com/Ego12138/remind-me /tmp/remind-me
```

都失败则询问用户本机代理端口。

## 3. 拿到企业微信机器人 key（若用户还没有）

指导用户：企业微信 App（个人可免费注册）→ 建一个只有自己的群 → 群设置 → 群机器人（新版本叫「消息推送」，需先在企业微信管理后台 → 应用管理 → 消息推送 里把可创建成员设为自己）→ 新建 → 复制 Webhook 地址中 `key=` 后面的部分。**用户发来 key 后不要写入任何会进入 git 的文件。**

## 4. 运行安装器（推荐）

```bash
node /tmp/remind-me/install.js --key <用户的key>
```

安装器会自动：安装内核到 `~/.agent-notify/`、安装技能到 `~/.agents/skills/task-notify/`、检测已装工具并幂等合并 hook 配置（ZCode/Claude Code/Codex/Cursor/WorkBuddy）、发送一条测试消息。产出末尾有每个工具的接入结果，如实向用户汇报。

安装器失败时手动执行：

1. 复制 `scripts/` 下三个文件到 `~/.agent-notify/scripts/`，复制 `SKILL.md` 和 `scripts/` 到 `~/.agents/skills/task-notify/`。
2. 写配置：`echo 'WECOM_WEBHOOK_KEY=<key>' > ~/.agent-notify/task-notify.conf`。
3. 按仓库 README「接入你的 agent 工具」一节，对**检测到存在**的工具逐一合并配置（JSON 必须先读原文件再合并，**不得整体覆盖**，用户可能有其他自定义配置）。
4. 测试：`bash ~/.agent-notify/scripts/notify.sh "✅ task-notify 安装成功"`，确认输出 `errcode:0`。

## 5. 收尾

- 提醒用户：hook 配置在**会话启动时加载**，各工具需重启或新开会话生效。
- 若用户想让"每条回复都通知"，确认其工具已接入 Stop hook 即可，无需额外操作；中途阻塞提醒由技能（SKILL.md）驱动，无需配置。
- 汇报安装结果：装了什么、接入了哪些工具、测试消息是否收到。
