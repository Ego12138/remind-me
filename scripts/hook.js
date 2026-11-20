#!/usr/bin/env node
// 通用 agent 通知内核: 收到"回合结束"事件时,把最后一条回复的摘要发送到企业微信群机器人。
// 支持三种输入方式(自动识别),由各家工具的 hook 配置指向本文件:
//   1. stdin JSON 含 transcript_path  —— Claude Code / ZCode 的 Stop hook
//   2. 命令行参数传 JSON               —— Codex CLI 的 notify (agent-turn-complete)
//   3. stdin JSON 其他字段             —— Cursor 等 (afterAgentResponse / stop)
// 任何失败都静默退出 0,不影响主流程。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const HOME = os.homedir();
const CONF = path.join(HOME, '.agent-notify', 'task-notify.conf');
const LOG = path.join(HOME, '.agent-notify', 'hook.log');
const TEXT_KEYS = ['last-assistant-message', 'lastAssistantMessage', 'last_message', 'lastMessage',
    'response', 'message', 'content', 'text', 'preview'];

function readKey() {
    try {
        const m = fs.readFileSync(CONF, 'utf8').match(/WECOM_WEBHOOK_KEY\s*=\s*(\S+)/);
        return m ? m[1] : null;
    } catch { return null; }
}

function log(msg) {
    try {
        fs.mkdirSync(path.dirname(LOG), { recursive: true });
        fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
    } catch { /* 日志失败无所谓 */ }
}

// 异步读 stdin。Windows 下同步读管道(fd 0)会拿到空内容,必须走事件流。
// 3 秒兜底定时器已 unref: stdin 不结束(如 TTY)也能继续走,且不拖长进程存活。
function readStdin() {
    return new Promise(resolve => {
        let data = '';
        const done = () => resolve(data);
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', d => { data += d; });
        process.stdin.on('end', done);
        process.stdin.on('error', done);
        const t = setTimeout(done, 3000);
        t.unref();
    });
}

// 归一化路径: 兼容 Git Bash 风格 /c/Users/... 与 Windows 风格 C:\Users\...
function normalizePath(p) {
    if (!p) return p;
    const s = String(p);
    const m = s.match(/^\/([a-zA-Z])\/(.*)/);
    if (m) return m[1].toUpperCase() + ':/' + m[2].replace(/\\/g, '/');
    return s;
}

// 从会话记录(JSONL)末尾往前找最后一条带文本的 assistant 消息
function lastAssistantText(transcriptPath) {
    let lines;
    try {
        lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
    } catch { return ''; }
    for (let i = lines.length - 1; i >= 0; i--) {
        try {
            const e = JSON.parse(lines[i]);
            const msg = e.message || e;
            const role = msg.role || e.role;
            const type = e.type || '';
            if (!(role === 'assistant' || type === 'assistant')) continue;
            const content = msg.content !== undefined ? msg.content : e.content;
            if (typeof content === 'string' && content.trim()) return content.trim();
            if (Array.isArray(content)) {
                const t = content.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n').trim();
                if (t) return t;
            }
        } catch { /* 跳过坏行 */ }
    }
    return '';
}

function extractText(input) {
    const tp = normalizePath(input.transcript_path || input.transcriptPath);
    if (tp) {
        const t = lastAssistantText(tp);
        if (t) return t;
    }
    for (const k of TEXT_KEYS) {
        const v = input[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
}

function send(text, key) {
    return new Promise(resolve => {
        let body = '';
        const req = https.request({
            hostname: 'qyapi.weixin.qq.com',
            path: '/cgi-bin/webhook/send?key=' + key,
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            timeout: 10000
        }, res => {
            res.on('data', d => { body += d; });
            res.on('end', () => resolve(body));
        });
        req.on('error', e => resolve(`error: ${e.message}`));
        req.on('timeout', () => { req.destroy(); resolve('error: timeout'); });
        req.end(JSON.stringify({ msgtype: 'text', text: { content: text } }));
    });
}

// 直接发送指定文本(已是最终内容,非事件 JSON): 前缀、截断、发送
async function sendText(text, keyArg) {
    const key = keyArg || readKey();
    if (!key) { log('未配置 key，跳过'); return; }
    text = '💬 ' + String(text).replace(/\s+/g, ' ').trim();
    const arr = Array.from(text);
    if (arr.length > 300) text = arr.slice(0, 300).join('') + '…';
    const resp = await send(text, key);
    log(`已发送: ${text.slice(0, 80)}... => ${resp}`);
}

async function processEvent(raw) {
    const key = readKey();
    if (!key) { log('未配置 key，跳过'); return; }
    log(`收到事件 ${raw ? raw.length : 0} 字节: ${String(raw).slice(0, 500)}`);

    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { /* 不是 JSON 就走兜底文案 */ }

    let text = extractText(input);
    if (!text) text = '有一条新回复，回来看看。';
    await sendText(text, key);
}

if (require.main === module) {
    (async () => {
        // Codex 把事件 JSON 作为命令行参数传入;其余工具走 stdin
        const argJson = process.argv.slice(2).find(a => a && a.trim().startsWith('{'));
        await processEvent(argJson !== undefined ? argJson : await readStdin());
    })().then(() => process.exit(0)).catch(e => { log(`异常: ${e && e.message}`); process.exit(0); });
}

module.exports = { processEvent, sendText, log };
