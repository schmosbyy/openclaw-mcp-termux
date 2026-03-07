# Remote HTTP setup (Claude.ai)

To securely bridge your OpenClaw assistant running on Android (Termux) to **Claude.ai on the web**, use the remote HTTP transport mode via Cloudflare Tunnel.

## 1. Install `cloudflared` on Android
```bash
pkg install cloudflared -y
```

## 2. Generate a Bridge Security Token
You need a random, strong secret token that Claude.ai will use to authenticate to your newly built bridge server.

Run the provided helper script:
```bash
bash scripts/gen-token.sh
```
Copy the 32-character string. Open `.env` and paste it for `BRIDGE_TOKEN`.

## 3. Run the MCP Bridge persistently
Android kills processes when the screen turns off. To fix this, run the bridge server in a tmux session and acquire a wake-lock:
```bash
bash scripts/start-tmux.sh
```
This forces the MCP Server into `http` transport mode and keeps it alive.

## 4. Run `cloudflared` Tunnel
In a new terminal or tmux split, expose port 3000 to the public internet using Cloudflare Tunnel:
```bash
cloudflared tunnel --url http://127.0.0.1:3000
```
It will print out a URL ending in `.trycloudflare.com` (for example, `https://random-word-test.trycloudflare.com`). Note: unless you attach a permanent Cloudflare tunnel, this random URL changes every time you restart `cloudflared`.

## 5. Connect to Claude.ai
1. Log in to [Claude.ai](https://claude.ai)
2. Go to your Settings
3. Switch to **Integrations**
4. Add a Custom MCP Server
5. URL: `https://your-random-url.trycloudflare.com`
6. Enter `BRIDGE_TOKEN` when asked for an authentication token.

You're done! Claude.ai can now orchestrate OpenClaw.
