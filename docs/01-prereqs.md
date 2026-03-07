# Prerequisites on Android/Termux

To run this project, you need to execute the following commands in Termux to install all necessary dependencies.

```bash
# Update local package index
pkg update && pkg upgrade -y

# Install Node.js v22+
pkg install nodejs -y

# Install tmux for persistent background sessions
pkg install tmux -y

# Install openssl for token generation scripts
pkg install openssl-tool -y

# (Optional) Install cloudflared for remote Claude.ai access
pkg install cloudflared -y
```

### Wake Lock
Termux provides a `termux-wake-lock` utility out of the box. This is what prevents Android from putting Termux (and your MCP bridge/Gateway) to sleep when the screen locks. Our `scripts/start-tmux.sh` script automatically engages it.
