# openclaw-mcp-termux

An MCP (Model Context Protocol) server running natively on Android via Termux. It acts as a secure, full-featured bridge connecting Claude.ai (or local clients like Cursor/Claude Desktop) to a locally-running OpenClaw orchestration assistant.

---

## 🏗 Architecture & Features

This MCP server acts as a proxy bridge intercepting structured tool calls from Claude and converting them into direct interaction with the underlying natively-hosted OpenClaw gateway. 

**Key Architectural Features:**
- **Proot-Ubuntu Integration**: OpenClaw natively runs in a `proot-Ubuntu` environment on Termux. This bridge runs in raw Termux Node.js but meticulously routes tool requests, diagnostics, and binary paths back into the proot environment.
- **Dual Transport Backbone**:
  - `stdio`: Built directly into SSH for local clients (Claude Desktop, Cursor). 
  - `Streamable HTTP`: For remote web clients like Claude.ai via Cloudflare Tunnel.
- **Live Token Refresh (`TokenProvider`)**: Dynamically reads `~/.openclaw/devices/paired.json` to recover mid-session from 401/403 errors when the gateway rotates authentication tokens.
- **No Docker Required**: Entirely native compilation.

```text
Claude.ai              ──[HTTP/SSE]──► Cloudflared Tunnel ──►
        OR                                                  └──► [openclaw-mcp-termux] ──[HTTP]──► OpenClaw Gateway (127.0.0.1:18789)
Local Client (Cursor)  ──[stdio]─────► SSH connection     ──►
```

---

## 🛠 Available Tools (The Catalog)

This bridge exposes exactly **15 tools** to Claude to act as a robust orchestrator.

### Agent Orchestration
| Tool | Description |
|------|-------------|
| `tani_send` | Send a structured task or plan to Tani (OpenClaw orchestrator). This passes instructions downstream to specialized subagents. |
| `tani_sessions_list` | List recent sessions for any agent. Useful to find an ID to resume an ongoing execution plan. |
| `tani_sessions_detail` | Enriched tree view of all agents. Exposes which sessions are currently active, compaction counts, and last tools called. |
| `tani_current_actions` | Check if any agent is currently busy. Required to be called **before** `tani_send` to prevent interrupting ongoing work. |
| `tani_agent_status` | Fast, reliable health check verifying HTTP 400 rejection behaviors against the OpenClaw gateway. |

### File Operations (Safe & Structured)
*These tools replace brittle shell commands with native Node.js filesystem modules, eliminating shell escaping failures.*
| Tool | Description |
|------|-------------|
| `file_read` | Read full or partial file contents. Accepts an absolute path and supports `start_line` / `end_line` slicing. |
| `file_write` | Atomically safely creates or overwrites entire file contents securely. |
| `file_str_replace` | Precision text editor: replaces a unique string in a file (`old_str`) with `new_str`. Prevents regex or `sed` truncation issues. |
| `file_search` | Uses raw Node.js to scan directories for specific filenames, returning absolute paths. |

### Diagnostics & Control
| Tool | Description |
|------|-------------|
| `openclaw_config` | Advanced dot-path configuration editor (e.g., `agents.list[0].model`). Reads/writes directly via the native openclaw binary. |
| `openclaw_logs` | Unified log ingestion. Fetches specific scenario logs: `gateway`, `gateway_errors`, `commands`, `heartbeat`, `rclone`, and `health`. Automatically strips ANSI and redacts tokens. |
| `tani_doctor` | Executes `openclaw doctor` within the proot environment to debug native installation failures. |
| `system_health` | Snapshot of Termux device RAM, CPU load, disk space, and node execution status. Safe and fast. |
| `openclaw_gateway_restart` | Returns manual instructions for restarting the gateway (hot-reloading via remote not supported explicitly yet). |
| `shell_exec` | Execute arbitrary bash scripts in Termux. Only to be manually invoked for highly specific diagnostics. |

---

## 🚀 Quick Start (Local stdio mode via SSH)

This setup is for developers using a Mac/PC where the MCP Client (Cursor or Claude Desktop) is local, but OpenClaw runs on the Android device over WiFi.

1. **Install Prerequisites in Termux**
   ```bash
   pkg update && pkg upgrade -y
   pkg install nodejs git proot-distro tmux -y
   proot-distro install ubuntu
   ```

2. **Clone & Build**
   ```bash
   git clone https://github.com/yourusername/openclaw-mcp-termux.git
   cd openclaw-mcp-termux
   npm install && npm run build
   ```

3. **Configure Environment**
   ```bash
   cp .env.example .env
   # Extract your token to put in the .env file
   grep OPENCLAW_GATEWAY_TOKEN ~/.openclaw/.env
   ```

4. **Configure your MCP Client (e.g., Claude Desktop)**
   Add the following to your `claude_desktop_config.json`, pointing your local SSH alias (`android`) against the Termux directory paths:
   ```json
   {
     "mcpServers": {
       "openclaw-tani": {
         "command": "/usr/bin/ssh",
         "args": [
           "android",
           "OPENCLAW_GATEWAY_TOKEN=your-token-here /data/data/com.termux/files/usr/bin/node /data/data/com.termux/files/home/openclaw-mcp-termux/dist/index.js"
         ]
       }
     }
   }
   ```

---

## 🌐 Connecting Claude.ai (Remote HTTP mode)

If you want to use Claude.ai on the web to talk to your Android's OpenClaw, you must expose this bridge over HTTP.

1. **Generate a Bridge Token & Start the Server**
   ```bash
   bash scripts/gen-token.sh # Paste resulting BRIDGE_TOKEN into .env
   bash scripts/start-tmux.sh # Persistent background execution
   ```

2. **Expose network via Cloudflare**
   ```bash
   pkg install cloudflared -y
   cloudflared tunnel --url http://127.0.0.1:3000
   ```
   *Copy the generic `.trycloudflare.com` URL (or your static Cloudflare domain).*

3. Goto **Claude.ai Settings** → **Integrations** → **Add custom connector**. Provide your Tunnel URL and the `BRIDGE_TOKEN`.

---

## ⚙️ Environment Variables Reference

Edit the `.env` file to customize behaviors. See `.env.example` for defaults.

| Variable | Required | Description |
|---|---|---|
| `OPENCLAW_URL` | Yes | Local URL of your OpenClaw gateway (default `http://127.0.0.1:18789`) |
| `OPENCLAW_GATEWAY_TOKEN` | Yes | Bearer Token pointing strictly to `~/.openclaw/.env` |
| `BRIDGE_TOKEN` | Remote HTTP | Bearer auth token for external Claude.ai web clients |
| `OPENCLAW_DEVICE_ID` | Optional | Stable hardware UUID of your device. If missing, `TokenProvider` will auto-detect from `paired.json` |
| `OPENCLAW_BIN_PATH` | Optional | Path to openclaw binary. Bridge defaults to Termux home `bin/openclaw-proot.sh` |
| `OPENCLAW_TIMEOUT_MS` | Optional | Wait time for downstream HTTP inference (default 30 mins) |
| `TRANSPORT` | Optional | `stdio` or `http` |

---

## 🐛 Troubleshooting

| Issue | Resolution |
|---|---|
| `Cannot find module` on start | Code is uncompiled. Run `npm run build` |
| Server dies after screen lock | Always run via `bash scripts/start-tmux.sh` which claims a `termux-wake-lock` to keep Android awake. |
| `GATEWAY_AUTH_FAILED` | Gateway token rotated and `TokenProvider` failed to refresh. Confirm your `paired.json` contains a valid operator token, or update `OPENCLAW_GATEWAY_TOKEN` manually. |
| `GATEWAY_UNREACHABLE` | Gateway not running. Start it on the phone using `openclaw-proot.sh gateway` inside proot-Ubuntu. |

---

## 📂 Developer Guide & Project Structure

- `src/index.ts`: The primary entry point. Decouples startup logic into eagerly detecting device IDs for `TokenProvider`, setting up `OpenClawGatewayClient`, and bridging to `src/server.ts`.
- `src/server.ts`: The literal MCP spec router that defines the 15 tools cleanly via the `@modelcontextprotocol/sdk`.
- `src/gateway/client.ts`: Wraps `fetch` explicitly for targeting OpenClaw HTTP behavior. Intercepts 401s for live token refresh. Executes raw proot commands safely using parameterized `process.env.PATH` injecting logic.
- `src/tools/`: Each tool gets a designated handler exporting a statically typed schema matching MCP constraints. No raw tools bleed logic into the router.
