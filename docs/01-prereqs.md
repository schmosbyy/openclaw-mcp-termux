# Prerequisites on Android/Termux

To run this project, you need to execute the following commands in Termux to install all necessary dependencies.

```bash
# Update local package index
pkg update && pkg upgrade -y

# Install Node.js, git, proot-distro
pkg install nodejs git proot-distro -y

# Install tmux, openssl
pkg install tmux openssl-tool -y

# (Optional) Install cloudflared for remote Claude.ai access
pkg install cloudflared -y
```

### Set up proot-Ubuntu (gateway runtime)

The OpenClaw gateway runs inside a proot Ubuntu environment. Set it up once:
```bash
proot-distro install ubuntu
```

Then start the gateway with:
```bash
openclaw-proot.sh gateway
```
Keep this running in a persistent Termux session (tmux recommended).

### Wake Lock
Termux provides a `termux-wake-lock` utility out of the box. This prevents Android from putting Termux (and your MCP bridge/Gateway) to sleep when the screen locks. It can be invoked manually with `termux-wake-lock`, and is also acquired automatically by `start-docker-vm.sh` if using the browser VM.
