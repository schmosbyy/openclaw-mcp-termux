# openclaw-mcp-termux

An MCP (Model Context Protocol) server that runs natively on Android via Termux, acting as a secure bridge between Claude.ai (or local clients) and your locally-running OpenClaw assistant.

## Features
- **No Docker Required**: Runs natively in Termux (Node.js).
- **Orchestrator Pattern**: Exposes 10 tools for Claude to orchestrate tasks through OpenClaw, check gateway health, inspect logs, run self-healing, and execute Android shell commands.
- **Dual Transport Mode**: 
  - `stdio` for local clients (Claude Desktop, Cursor).
  - `Streamable HTTP` for remote web clients (Claude.ai) via Cloudflare Tunnel.
- **Secure**: Uses Bearer token authentication for remote connections.
- `Tani is the name of the openclaw agent in this context`

---

## Architecture

This MCP server acts as a proxy bridge. The OpenClaw gateway only listens on localhost within Termux. This bridge exposes those capabilities to external MCP clients:

```text
Claude.ai              ──[HTTP/SSE]──► Cloudflared Tunnel ──►
        OR                                                  └──► [openclaw-mcp-termux] ──[HTTP]──► OpenClaw Gateway (127.0.0.1:18789)
Local Client (Cursor)  ──[stdio]─────► SSH connection     ──►
```

---

## Available Tools

This bridge exposes 10 tools to Claude, allowing it to fully manage and interact with your OpenClaw assistant:

| Tool | Description |
|------|-------------|
| `tani_send` | Send a task or plan to the Tani orchestrator |
| `tani_sessions_list` | List recent sessions for any agent |
| `tani_sessions_detail` | Enriched session view: active state, subagent flag, last tool call |
| `tani_agent_status` | Check gateway reachability and health (HTTP 400 = healthy by design) |
| `tani_current_actions` | Check if any agent is currently busy — call before tani_send |
| `system_health` | RAM, CPU, disk, and OpenClaw version snapshot |
| `tani_recent_log` | Tail the gateway error/crash log ⚠️ broken on 2026.3.12, fix pending |
| `openclaw_logs` | Session lifecycle event log (`~/.openclaw/logs/commands.log`) |
| `openclaw_gateway_restart` | Restart the gateway service |
| `shell_exec` | Execute shell commands on the Termux device |

---

## 🚀 Quick Start (Local stdio mode via SSH)

This setup is for when you want to use the MCP locally on your computer (e.g., Mac with Cursor or Claude Desktop) to connect to OpenClaw running on your Android device.

1. **Install Prerequisites in Termux**
   ```bash
   pkg install nodejs git proot-distro -y
   ```
   > **Note:** The OpenClaw gateway runs inside a proot-Ubuntu environment. Please follow the full setup in [docs/01-prereqs.md](docs/01-prereqs.md) before continuing.

2. **Clone & Build**
   ```bash
   git clone https://github.com/yourusername/openclaw-mcp-termux.git
   cd openclaw-mcp-termux
   npm install && npm run build
   ```

3. **Configure Environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set your `OPENCLAW_GATEWAY_TOKEN`. Find your token by running:
   ```bash
   grep OPENCLAW_GATEWAY_TOKEN ~/.openclaw/.env
   ```

4. **Configure your MCP Client (e.g., Claude Desktop on Mac)**
   Since the MCP server runs on Android but your client runs on Mac, you need SSH to bridge them. Make sure you have an SSH alias `android` in `~/.ssh/config` pointing to Termux. Add this to your `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "openclaw-tani": {
         "command": "/usr/bin/ssh",
         "args": [
           "android",
           "OPENCLAW_GATEWAY_TOKEN=your-token-here /data/data/com.termux/files/home/.openclaw-android/node/bin/node /data/data/com.termux/files/home/openclaw-mcp-termux/dist/index.js"
         ]
       }
     }
   }
   ```
   > **Note:** The env var is passed inline because SSH doesn't forward your local environment reliably.

---

## 🌐 Connecting Claude.ai (Remote HTTP mode)

If you want to use Claude.ai on the web to talk to your Android's OpenClaw, expose this bridge via a tunnel.

1. **Generate a Bridge Token**
   Run the helper script on Termux and add the 32-byte token to your `.env` explicitly as `BRIDGE_TOKEN`:
   ```bash
   bash scripts/gen-token.sh
   ```

2. **Start the Persistent Server**
   To prevent Android from killing the process when the screen locks, run inside the included tmux script:
   ```bash
   bash scripts/start-tmux.sh
   ```

3. **Expose via Cloudflare Tunnel**
   ```bash
   pkg install cloudflared
   cloudflared tunnel --url http://127.0.0.1:3000
   ```
   *Copy the `trycloudflare.com` URL printed.*

4. **Connect Claude.ai**
   - Go to **Claude.ai Settings** → **Integrations** → **Add custom connector**
   - Enter your Cloudflare Tunnel URL.
   - Enter your `BRIDGE_TOKEN` when prompted.

---

## Environment Variables Reference

Here are the supported environment variables (see `.env.example`):

| Variable | Required | Description | Default |
|---|---|---|---|
| `OPENCLAW_URL` | Yes | Local URL of your OpenClaw gateway | `http://127.0.0.1:18789` |
| `OPENCLAW_GATEWAY_TOKEN` | Yes | Gateway token from `~/.openclaw/.env` | - |
| `BRIDGE_TOKEN` | Remote Only | Bearer auth token for clients connecting to this MCP bridge | - |
| `PORT` | No | Port for the HTTP transport server | `3000` |
| `OPENCLAW_TIMEOUT_MS` | No | Timeout for gateway calls in milliseconds | `1800000` (30 mins) |
| `DEBUG` | No | Enable verbose request logging | `false` |
| `TRANSPORT` | No | Override transport mode (`stdio` or `http`) | `stdio` |

---

## Project Structure

```text
openclaw-mcp-termux/
├── src/
│   ├── index.ts        # Entrypoint; sets up stdio vs HTTP bindings
│   ├── server.ts       # MCP Server definitions
│   ├── transport.ts    # Transport modes
│   ├── auth.ts         # Bearer token auth for HTTP
│   ├── tools/          # Handlers for the 7 tools
│   └── gateway/        # External HTTP client wrapping the OpenClaw API
├── scripts/
│   ├── gen-token.sh    # Secure token generator
│   └── start/stop-tmux.sh # Persistent wake-locked background running
├── docs/               # Technical setup documentation
└── .env.example
```

---

## Technical Docs

- [01. Prerequisites](docs/01-prereqs.md)
- [02. Local stdio setup](docs/02-local-stdio.md)
- [03. Remote HTTP setup](docs/03-remote-http.md)
- [04. Tailscale Alternative](docs/04-tailscale.md)
- [05. Troubleshooting](docs/05-troubleshooting.md)
