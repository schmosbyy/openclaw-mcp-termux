# openclaw-mcp-termux

An MCP (Model Context Protocol) server running natively on Android via Termux. Bridges Claude.ai or Claude Desktop to a locally-running OpenClaw gateway using 10 consolidated tools optimized for the God Orchestrator pattern.

---

## Architecture

```
Sakaar (vision/intent)
  → Claude (compiler — frontier inference)
    → MCP Bridge (this server — 10 tools)
      → OpenClaw Gateway (127.0.0.1:18789)
        → Agents: Tani (main), Alan (coding), Rachel (rachel)
```

The MCP bridge is the transport layer between Claude's compiler and the OpenClaw execution agents. It provides three capabilities: **dispatch** (send tasks to agents), **observe** (monitor agent state), and **control** (intervene on running sessions).

**Transport:**
- `stdio` over SSH — Claude Desktop connects via `ssh flip "node dist/index.js"`
- `Streamable HTTP` — Claude.ai via Cloudflare Tunnel

**Key design decisions:**
- **SSH-first CLI** — all `openclaw` CLI calls route through `ssh proot` (~200ms) instead of the wrapper script (2-10s cold start)
- **Filesystem-first reads** — config/session/log reads hit files directly (~16ms) instead of shelling out to the CLI
- **TokenProvider** — reads `paired.json` for live token refresh, handles gateway token rotation mid-session
- **No Docker** — runs natively in Termux Node.js, OpenClaw runs in proot-Ubuntu

---

## 10 Tools

### Agent Orchestration

| Tool | Description |
|------|-------------|
| `agent_dispatch` | Send tasks to agents. Three modes: `async` (fire-and-forget via webhook), `sync` (wait for reply), `spawn` (tracked sub-agent delegation with runId). Routes to Tani/Alan/Rachel. |
| `agent_query` | Multi-view observation. Views: `health` (gateway status), `sessions` (all agent sessions with JSONL metadata), `actions` (active processes + recent tool calls + log tail), `logs` (gateway/command/heartbeat/rclone scenarios), `history` (JSONL transcript read). |
| `agent_control` | Session management: abort, steer, compact, reset. Uses gateway `/tools/invoke` API with CLI fallback guidance. |

### File Operations

| Tool | Description |
|------|-------------|
| `file_read` | Read full or partial file contents. Supports `start_line`/`end_line` slicing. |
| `file_write` | Create or overwrite files. Auto-creates parent directories. |
| `file_edit` | Replace a unique string in a file with another. No shell escaping. |
| `file_search` | Recursive directory search for literal string patterns. Case-insensitive. |

### System & CLI

| Tool | Description |
|------|-------------|
| `openclaw_cli` | OpenClaw CLI operations. `config_get` reads filesystem directly (~16ms via JSON5 parse). `config_set`/`doctor`/`version` use SSH to proot. `restart` returns manual instructions. |
| `shell_exec` | Execute arbitrary shell commands on the Termux device. Safety blocklist for destructive patterns. |
| `system_health` | Device snapshot: RAM, CPU load, disk, gateway reachability, active processes. |

---

## Quick Start (Local stdio via SSH)

1. **Clone & Build on the device**
   ```bash
   git clone https://github.com/schmosbyy/openclaw-mcp-termux.git
   cd openclaw-mcp-termux
   npm install && npm run build
   ```

2. **Configure Claude Desktop** (`claude_desktop_config.json`)
   ```json
   {
     "mcpServers": {
       "flip": {
         "command": "/usr/bin/ssh",
         "args": [
           "flip",
           "OPENCLAW_GATEWAY_TOKEN=your-token OPENCLAW_HOOK_SECRET=your-secret /data/data/com.termux/files/usr/bin/node /data/data/com.termux/files/home/openclaw-mcp-termux/dist/index.js"
         ]
       }
     }
   }
   ```

---

## Remote HTTP Mode (Claude.ai)

1. **Start the bridge**
   ```bash
   bash scripts/gen-token.sh   # generates BRIDGE_TOKEN
   bash scripts/start-tmux.sh  # persistent background
   ```

2. **Expose via Cloudflare**
   ```bash
   cloudflared tunnel --url http://127.0.0.1:3000
   ```

3. Add the tunnel URL + `BRIDGE_TOKEN` in Claude.ai → Settings → Integrations.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Yes | Gateway bearer token. `TokenProvider` refreshes from `paired.json` on rotation. |
| `OPENCLAW_HOOK_SECRET` | Yes | Webhook secret for `/hooks/agent` (async dispatch). |
| `OPENCLAW_URL` | No | Gateway URL (default `http://127.0.0.1:18789`) |
| `BRIDGE_TOKEN` | HTTP mode | Auth token for remote Claude.ai connections |
| `OPENCLAW_DEVICE_ID` | No | Device UUID. Auto-detected from `paired.json` if omitted. |
| `OPENCLAW_TIMEOUT_MS` | No | HTTP timeout (default 660000ms) |
| `TRANSPORT` | No | `stdio` or `http` (default `stdio`) |

---

## Project Structure

```
src/
├── index.ts              # Entry point, transport selection, token bootstrap
├── server.ts             # MCP tool registry (10 tools) + dispatch router
├── transport.ts          # stdio vs StreamableHTTP transport
├── auth.ts               # Bearer token auth for HTTP mode
├── gateway/
│   ├── client.ts         # GatewayClient — HTTP API + SSH CLI + token refresh
│   ├── token-provider.ts # Reads paired.json for live token rotation
│   └── types.ts          # TypeScript response interfaces
└── tools/
    ├── agent_dispatch.ts  # Send to agents (async/sync/spawn)
    ├── agent_query.ts     # Observe agents (health/sessions/actions/logs/history)
    ├── agent_control.ts   # Control sessions (abort/steer/compact/reset)
    ├── openclaw_cli.ts    # CLI ops (config_get via FS, config_set via SSH)
    ├── file_read.ts       # Read files
    ├── file_write.ts      # Write files
    ├── file_edit.ts       # Edit files (string replace)
    ├── file_search.ts     # Search files
    ├── shell_exec.ts      # Shell commands
    └── system_health.ts   # Device health snapshot
```

---

## Troubleshooting

| Issue | Resolution |
|---|---|
| `Cannot find module` | Run `npm run build` |
| Server dies after screen lock | Run via `bash scripts/start-tmux.sh` (claims `termux-wake-lock`) |
| Auth failures after token rotation | `TokenProvider` auto-refreshes. If it can't, check `paired.json` has a valid operator token. |
| Gateway unreachable | Start it on the device: `~/bin/openclaw-proot.sh` inside Termux |
| `ssh proot` fails from MCP tools | SSH tunnel dies with gateway. Restart gateway to restore. |
