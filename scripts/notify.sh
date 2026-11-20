#!/usr/bin/env bash
# 通过企业微信群机器人 webhook 发送通知(工具无关,任何 agent 都能调)。
# 用法: notify.sh "消息内容"
# 配置: ~/.agent-notify/task-notify.conf 中一行 WECOM_WEBHOOK_KEY=你的key
#       也可用环境变量 WECOM_WEBHOOK_KEY 或 WECOM_WEBHOOK_CONFIG 覆盖。
set -euo pipefail

CONFIG_FILE="${WECOM_WEBHOOK_CONFIG:-$HOME/.agent-notify/task-notify.conf}"
KEY="${WECOM_WEBHOOK_KEY:-}"
if [ -z "$KEY" ] && [ -f "$CONFIG_FILE" ]; then
    # shellcheck source=/dev/null
    . "$CONFIG_FILE"
    KEY="${WECOM_WEBHOOK_KEY:-}"
fi
if [ -z "$KEY" ]; then
    echo "错误: 未配置企业微信机器人 key。" >&2
    echo "请在 $CONFIG_FILE 写入一行: WECOM_WEBHOOK_KEY=你的key" >&2
    exit 1
fi

if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
    echo "用法: notify.sh \"消息内容\"" >&2
    exit 1
fi
MSG="$1"

# 按 JSON 字符串规则转义: 反斜杠、双引号、制表符; 换行(CR/LF)统一占位后转成 \n
CONTENT=$(printf '%s' "$MSG" \
    | tr '\r' '\n' \
    | tr '\n' '\001' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e $'s/\t/\\\\t/g' \
    | sed 's/\001/\\n/g')

PAYLOAD="{\"msgtype\":\"text\",\"text\":{\"content\":\"$CONTENT\"}}"
# 消息必须走 stdin(--data-binary @-): 若放在命令行参数里, bash 调用原生 curl.exe 时
# 会被 Windows 按 ANSI 代码页(中文系统为 GBK)转码, 导致中文乱码、emoji 变问号。
RESP=$(printf '%s' "$PAYLOAD" | curl -s -m 15 -X POST \
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=$KEY" \
    -H 'Content-Type: application/json; charset=utf-8' \
    --data-binary @-)

echo "$RESP"
case "$RESP" in
    *'"errcode":0'*) exit 0 ;;
    *) echo "发送失败(响应见上)。errcode 非 0 通常是 key 无效或消息超限。" >&2
       exit 1 ;;
esac
