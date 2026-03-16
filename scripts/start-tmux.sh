#!/data/data/com.termux/files/usr/bin/bash
# openclaw-mcp-termux: Start the MCP bridge in a persistent tmux session

SESSION="openclaw-mcp"

# Prevent Android from killing the Termux process
termux-wake-lock
echo "✅ Wake lock acquired"

# Kill existing session if running
tmux kill-session -t "$SESSION" 2>/dev/null

# Start new detached tmux session running the bridge
tmux new-session -d -s "$SESSION" -x 220 -y 50 \
  "cd $(dirname "$0")/.. && /data/data/com.termux/files/usr/bin/node dist/index.js --transport http 2>&1 | tee /tmp/openclaw-mcp.log"

echo "✅ openclaw-mcp-termux started in tmux session '$SESSION'"
echo ""
echo "To view logs:    tmux attach -t $SESSION"
echo "To stop:         bash scripts/stop-tmux.sh"
echo "To view log file: tail -f /tmp/openclaw-mcp.log"
