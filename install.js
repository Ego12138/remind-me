#!/usr/bin/env node
'use strict';
/* task-notify 一键安装器（人和 AI 均可运行，幂等：重复执行不会重复写配置）
 * 用法: node install.js [--key <企业微信机器人key>] [--tools zcode,claude,codex,cursor,workbuddy] [--repo <已克隆的仓库路径>]
 * 不带 --repo 时从 GitHub 克隆；直连失败会自动尝试常见本机代理端口。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const HOME = os.homedir();
const REPO_URL = 'https://github.com/Ego12138/remind-me';
const KERNEL_DIR = path.join(HOME, '.agent-notify');
const SKILL_DIR = path.join(HOME, '.agents', 'skills', 'task-notify');
const HOOK_JS = path.join(KERNEL_DIR, 'scripts', 'hook.js');
const PROXY_PORTS = [7890, 7897, 10808, 10809, 2080]; // 常见本地混合代理端口

const argv = process.argv.slice(2);
function argOf(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }
const KEY = argOf('--key');
const TOOLS = (argOf('--tools') || 'zcode,claude,codex,cursor,workbuddy').split(',').map(s => s.trim().toLowerCase());
const REPO_OPT = argOf('--repo');

function log(s) { console.log(s); }
function fwd(p) { return String(p).replace(/\\/g, '/'); }

// ---------- 1. 获取源码 ----------
function fetchRepo() {
  if (REPO_OPT && fs.existsSync(REPO_OPT)) return REPO_OPT;
  const tmp = path.join(os.tmpdir(), 'task-notify-install-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const attempts = [null, ...PROXY_PORTS.map(p => `http://127.0.0.1:${p}`)];
  for (const proxy of attempts) {
    try {
      log(`尝试克隆（${proxy ? '代理 ' + proxy : '直连'}）...`);
      execSync(`git clone --depth 1 ${REPO_URL} "${tmp}/remind-me"`, {
        stdio: 'pipe', timeout: 60000,
        env: proxy ? { ...process.env, HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : process.env
      });
      return path.join(tmp, 'remind-me');
    } catch { /* 尝试下一种方式 */ }
  }
  throw new Error('克隆失败：请检查网络/代理，或用 --repo 指向已克隆好的仓库路径');
}

// ---------- 2. 安装文件 ----------
function installFiles(repo) {
  fs.mkdirSync(path.join(KERNEL_DIR, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(SKILL_DIR, 'scripts'), { recursive: true });
  const cp = (from, to) => fs.copyFileSync(path.join(repo, from), to);
  for (const f of ['hook.js', 'notify.sh', 'codex-notify.js']) {
    cp('scripts/' + f, path.join(KERNEL_DIR, 'scripts', f));
    cp('scripts/' + f, path.join(SKILL_DIR, 'scripts', f));
  }
  cp('examples/trae-hooks.json', path.join(KERNEL_DIR, 'trae-hooks.json'));
  cp('SKILL.md', path.join(SKILL_DIR, 'SKILL.md'));
  // conf：不存在则创建；存在且指定 --key 则替换
  const conf = path.join(KERNEL_DIR, 'task-notify.conf');
  let content = 'WECOM_WEBHOOK_KEY=在这里粘贴你的key\n';
  if (fs.existsSync(conf)) content = fs.readFileSync(conf, 'utf8');
  if (KEY) {
    if (/WECOM_WEBHOOK_KEY\s*=/.test(content)) content = content.replace(/WECOM_WEBHOOK_KEY\s*=\s*\S+/, `WECOM_WEBHOOK_KEY=${KEY}`);
    else content += `WECOM_WEBHOOK_KEY=${KEY}\n`;
  }
  fs.writeFileSync(conf, content);
}

// ---------- 3. 各工具 hook 配置（幂等合并） ----------
function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
function writeJSON(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }
const CMD = `${fwd(process.execPath)} ${fwd(HOOK_JS)}`;

function wireZcode() {
  const p = path.join(HOME, '.zcode', 'cli', 'config.json');
  if (!fs.existsSync(p)) return 'ZCode: 未安装，跳过';
  const obj = readJSON(p);
  obj.hooks = obj.hooks || {};
  obj.hooks.enabled = true;
  obj.hooks.events = obj.hooks.events || {};
  obj.hooks.events.Stop = obj.hooks.events.Stop || [];
  if (obj.hooks.events.Stop.some(g => JSON.stringify(g).includes('hook.js'))) return 'ZCode: 已配置，跳过';
  obj.hooks.events.Stop.push({ hooks: [{ type: 'process', command: process.execPath, args: [HOOK_JS], timeoutMs: 15000, statusMessage: '发送企业微信通知' }] });
  writeJSON(p, obj);
  return 'ZCode: ✓ Stop hook 已写入';
}

function wireClaudeLike(cfgPath, label) {
  if (!fs.existsSync(cfgPath)) return `${label}: 未安装，跳过`;
  const obj = readJSON(cfgPath);
  obj.hooks = obj.hooks || {};
  obj.hooks.Stop = obj.hooks.Stop || [];
  if (obj.hooks.Stop.some(g => JSON.stringify(g).includes('hook.js'))) return `${label}: 已配置，跳过`;
  obj.hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command: CMD, timeout: 15 }] });
  writeJSON(cfgPath, obj);
  return `${label}: ✓ Stop hook 已写入`;
}

function wireCodex() {
  const p = path.join(HOME, '.codex', 'config.toml');
  if (!fs.existsSync(p)) return 'Codex: 未安装，跳过';
  let t = fs.readFileSync(p, 'utf8');
  if (/codex-notify\.js/.test(t)) return 'Codex: 已配置，跳过';
  const line = `notify = [ "${fwd(process.execPath)}", "${fwd(path.join(KERNEL_DIR, 'scripts', 'codex-notify.js'))}" ]`;
  if (/^\s*notify\s*=/m.test(t)) return `Codex: ⚠️ 已有其他 notify 配置，请手动替换为: ${line}`;
  fs.writeFileSync(p, t.replace(/\r?\n$/, '') + `\n\n# task-notify 企业微信通知\n${line}\n`);
  return 'Codex: ✓ notify 已写入';
}

function wireCursor() {
  if (!fs.existsSync(path.join(HOME, '.cursor'))) return 'Cursor: 未安装，跳过';
  const p = path.join(HOME, '.cursor', 'hooks.json');
  const obj = fs.existsSync(p) ? readJSON(p) : {};
  obj.version = obj.version || 1;
  obj.hooks = obj.hooks || {};
  obj.hooks.afterAgentResponse = obj.hooks.afterAgentResponse || [];
  if (obj.hooks.afterAgentResponse.some(h => JSON.stringify(h).includes('hook.js')))
    return 'Cursor: 已配置，跳过（若未生效，把 ~/.cursor/hooks.json 复制到项目的 .cursor/hooks.json）';
  obj.hooks.afterAgentResponse.push({ comment: '回复结束发企业微信通知', command: CMD });
  writeJSON(p, obj);
  return 'Cursor: ✓（若未生效，把 ~/.cursor/hooks.json 复制到项目的 .cursor/hooks.json）';
}

// ---------- 4. 测试发送 ----------
async function testSend() {
  const conf = path.join(KERNEL_DIR, 'task-notify.conf');
  const t = fs.existsSync(conf) ? fs.readFileSync(conf, 'utf8') : '';
  if (!/WECOM_WEBHOOK_KEY\s*=\s*\S+/.test(t) || /在这里粘贴/.test(t))
    return '测试发送: 跳过（conf 还没填 key；填好后运行 bash ~/.agent-notify/scripts/notify.sh "测试"）';
  const { sendText } = require(path.join(KERNEL_DIR, 'scripts', 'hook.js'));
  await sendText('✅ task-notify 安装成功，各工具重启/新开会话后生效');
  return '测试发送: 已执行，结果见 ~/.agent-notify/hook.log（errcode 0 为成功）';
}

(async () => {
  log('== task-notify 安装器 ==');
  const repo = fetchRepo();
  installFiles(repo);
  log(`已安装  内核 → ${KERNEL_DIR}\n已安装  技能 → ${SKILL_DIR}`);
  for (const t of TOOLS) {
    let r;
    if (t === 'zcode') r = wireZcode();
    else if (t === 'claude') r = wireClaudeLike(path.join(HOME, '.claude', 'settings.json'), 'Claude Code');
    else if (t === 'workbuddy') r = wireClaudeLike(path.join(HOME, '.workbuddy', 'settings.json'), 'WorkBuddy');
    else if (t === 'codex') r = wireCodex();
    else if (t === 'cursor') r = wireCursor();
    else { log(`  未知工具: ${t}（支持 zcode/claude/codex/cursor/workbuddy）`); continue; }
    log('  ' + r);
  }
  log(await testSend());
  log('安装完成。');
})().catch(e => { console.error('安装失败: ' + e.message); process.exit(1); });
