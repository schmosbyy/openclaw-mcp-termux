#!/data/data/com.termux/files/usr/bin/bash
tmux kill-session -t "openclaw-mcp" 2>/dev/null && echo "✅ Stopped" || echo "Session was not running"
termux-wake-unlock
echo "✅ Wake lock released"
