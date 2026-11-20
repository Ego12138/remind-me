#!/usr/bin/env node
// Codex CLI notify 转发器: config.toml 的 notify 只能配置一个程序。
// 行为: 若 task-notify.conf 里配置了 CODEX_PREVIOUS_NOTIFY, 先把事件原样转发给
// 那个原有通知程序(保留其功能), 再把回合结束事件发到企业微信(通用内核见 hook.js)。
// 用法: 在 ~/.codex/config.toml 中配置
//   notify = [ "node", "<本文件绝对路径>" ]
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { processEvent, log } = require('./hook.js');

const CONF = path.join(os.homedir(), '.agent-notify', 'task-notify.conf');

function readPreviousNotify() {
  try {
    const m = fs.readFileSync(CONF, 'utf8').match(/CODEX_PREVIOUS_NOTIFY\s*=\s*(.+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

const args = process.argv.slice(2);
const previous = readPreviousNotify();
if (previous && !process.env.AGENT_NOTIFY_TEST) {
  try {
    const child = spawn(previous, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', e => log(`转发原通知程序失败: ${e.message}`));
    child.unref();
  } catch (e) { log(`转发原通知程序异常: ${e.message}`); }
}

// Codex 把事件 JSON 作为命令行参数传入
const jsonArg = args.find(a => a && a.trim().startsWith('{')) || '';
processEvent(jsonArg).then(() => process.exit(0)).catch(() => process.exit(0));
