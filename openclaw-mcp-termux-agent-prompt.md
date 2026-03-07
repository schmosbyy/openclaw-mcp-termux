# Coding Agent Prompt: `openclaw-mcp-termux`

> **Purpose:** This document is a complete, self-contained instruction set for a coding agent to build `openclaw-mcp-termux` — an MCP (Model Context Protocol) server that runs natively on Android/Termux and bridges Claude.ai (or any MCP client) to a locally-running OpenClaw AI assistant instance.
>
> The agent should read this document in full before writing a single line of code. All environment facts, constraints, architecture decisions, and implementation details are specified here.

---

## 1. What You Are Building

You are building a **standalone Node.js MCP server** called `openclaw-mcp-termux`. It acts as a bridge:

```
Claude.ai  ──[MCP/SSE]──►  openclaw-mcp-termux  ──[HTTP]──►  OpenClaw Gateway (localhost:18789)
                  OR
MCP Client ──[MCP/stdio]──► openclaw-mcp-termux  ──[HTTP]──►  OpenClaw Gateway (localhost:18789)
```

The primary reference implementation is **`freema/openclaw-mcp`** (https://github.com/freema/openclaw-mcp). That project works on Linux/macOS with Docker. Your job is to build a version that works **natively on Android via Termux**, with no Docker, no root access, and no Linux-only assumptions.

---

## 2. The Target Environment — Read This Carefully

Every architectural decision must be compatible with this environment. Do not assume a standard Linux server.

### 2.1 Runtime Facts (confirmed live from target device)

| Property | Value |
|---|---|
| OS | Android (ARM64) |
| Shell environment | Termux (a Linux-compatible terminal emulator for Android) |
| Node.js version | **22.20.0** (glibc-compatible build, installed via `.openclaw-android/node/`) |
| Node install path | `/data/data/com.termux/files/home/.openclaw-android/node/` |
| npm global prefix | Resolvable via `npm root -g` in Termux |
| OpenClaw install path | `/data/data/com.termux/files/home/.openclaw-android/node/lib/node_modules/openclaw/` |
| OpenClaw config | `/data/data/com.termux/files/home/.openclaw/openclaw.json` |
| OpenClaw workspace | `/data/data/com.termux/files/home/.openclaw/workspace/` |
| OpenClaw workspace (coding agent) | `/data/data/com.termux/files/home/.openclaw/workspace-coding/` |
| OpenClaw workspace (rachel agent) | `/data/data/com.termux/files/home/.openclaw/workspace-rachel/` |
| TaniVault (daily notes) | `/data/data/com.termux/files/home/.openclaw/workspace/TaniVault/` |
| Log file | `/data/data/com.termux/files/usr/tmp/openclaw-<PID>/openclaw-<DATE>.log` |
| Home directory | `/data/data/com.termux/files/home/` |
| Termux prefix | `/data/data/com.termux/files/usr/` |
| Package manager | `pkg` (Termux's apt wrapper) |

### 2.2 What Does NOT Exist on Termux

These are the key divergences from a standard Linux environment. Your code must never assume any of these are available:

- ❌ `docker` / `docker-compose` — not available on Android without root
- ❌ `host.docker.internal` — Docker-specific hostname, meaningless on Termux
- ❌ `systemd` / `systemctl` — Android does not use systemd
- ❌ `/etc/ssl/certs` at standard paths — Termux has certs at `$PREFIX/etc/tls/cert.pem`
- ❌ `sudo` — no root access assumed
- ❌ `apt-get` — use `pkg` instead
- ❌ Standard Linux paths like `/usr/bin/`, `/etc/`, `/var/` — everything is under `/data/data/com.termux/files/`

### 2.3 What DOES Exist on Termux

- ✅ Node.js 22.20.0 (fully functional)
- ✅ `npm` and `npx`
- ✅ `tmux` (available via `pkg install tmux`) — the correct process persistence tool
- ✅ `termux-wake-lock` — prevents Android from killing background processes
- ✅ `openssl` (via `pkg install openssl-tool`) — needed for token generation
- ✅ `curl` (available)
- ✅ `pkg install cloudflared` — Cloudflare tunnel binary available for ARM64
- ✅ TypeScript compiles fine via `tsc` or `tsx`
- ✅ `fetch` API built into Node 22 — no `node-fetch` package needed

### 2.4 OpenClaw Gateway — How It Works

The OpenClaw gateway is a local HTTP + WebSocket server. Key confirmed facts:

- **Protocol:** HTTP REST + WebSocket, listening on `ws://127.0.0.1:18789`
- **Auth mode:** Bearer token (`Authorization: Bearer <token>`)
- **Gateway bind:** `loopback` only — it only listens on `127.0.0.1`, never `0.0.0.0`
- **Gateway mode:** `local` — not exposed to network by default
- **Token location:** Stored in `/data/data/com.termux/files/home/.openclaw/secrets.json`
- **The bridge connects to:** `http://127.0.0.1:18789` (HTTP, not HTTPS, because it's localhost)

The bridge communicates with the gateway via **HTTP**, not WebSocket, for tool calls. The gateway exposes HTTP endpoints that the bridge calls using the standard Node.js `fetch` API.

### 2.5 OpenClaw Agents (Confirmed Live)

The target user has three configured agents:

| Agent ID | Bot Username | Description | Model |
|---|---|---|---|
| `main` | `@tani_my_naukar_bot` | Primary assistant — "Tani" | `moonshotai/kimi-k2.5` via NVIDIA NIM |
| `coding` | `@hackermanpoplybot` | Coding subagent — "Alan" | `moonshotai/kimi-k2.5` via NVIDIA NIM |
| `rachel` | `@racheldocprocessorbot` | Document agent — "Rachel" | `moonshotai/kimi-k2.5` via NVIDIA NIM |

The agents communicate via Telegram. Session scope is `per-channel-peer`. Agent-to-agent delegation is enabled between `main`, `coding`, and `rachel`.

---

## 3. Reference Implementation Analysis (`freema/openclaw-mcp`)

You must understand how the reference project works before you diverge from it.

### 3.1 What it does well (keep these patterns)

- Dual transport: `stdio` for local MCP clients, `SSE` for remote (Claude.ai)
- Clean environment variable configuration (`OPENCLAW_URL`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_TIMEOUT_MS`)
- MCP SDK from `@modelcontextprotocol/sdk` — use the same SDK
- HTTP Bearer token auth to forward calls to the gateway
- `npx`-compatible entry point (no global install required)
- OAuth 2.1 for securing the SSE endpoint when exposed remotely

### 3.2 What it assumes that breaks on Termux (fix these)

| freema assumption | Termux reality | Your fix |
|---|---|---|
| Docker as primary deployment | No Docker on Android | `npx` / direct `node` execution only |
| `host.docker.internal` to reach gateway | Gateway is already at `127.0.0.1` | Use `http://127.0.0.1:18789` as default |
| Persistent process via Docker container | Process gets killed by Android | tmux session + `termux-wake-lock` startup script |
| SSL cert at `/etc/ssl/certs/` | Termux certs at `$PREFIX/etc/tls/cert.pem` | Set `NODE_EXTRA_CA_CERTS` or use `NODE_TLS_REJECT_UNAUTHORIZED=0` for localhost only |
| `openssl rand -hex 32` in shell | openssl available via `pkg install openssl-tool` | Document this prerequisite |
| Remote HTTPS via reverse proxy (Caddy/nginx) | No easy nginx on Android | Use Cloudflare Tunnel (`cloudflared`) or Tailscale |
| `MCP_ISSUER_URL` for OAuth metadata | Same requirement, different tunnel URL | `cloudflared` URL goes here |
| Deploy guide assumes VPS/Linux server | Must run on Android device | Full Termux startup guide required |

---

## 4. Architecture of What You Build

### 4.1 Repository Name

`openclaw-mcp-termux`

### 4.2 Two Operating Modes

**Mode A — Local stdio (Phase 1, build this first)**

The MCP server is launched by an MCP client (Claude Desktop, Cursor, etc.) as a child process via stdio. No network exposure. The bridge proxies tool calls to the local OpenClaw gateway.

```
MCP Client (Claude Desktop etc.)
  spawns: npx openclaw-mcp-termux
  env: OPENCLAW_URL=http://127.0.0.1:18789
       OPENCLAW_GATEWAY_TOKEN=<token>
```

**Mode B — Remote SSE (Phase 2, build after Mode A works)**

The bridge runs as a persistent HTTP server inside a tmux session. Cloudflare Tunnel exposes it as a public HTTPS URL. Claude.ai connects to it via OAuth 2.1.

```
Claude.ai ──[HTTPS/SSE]──► cloudflared tunnel ──► openclaw-mcp-termux (port 3000) ──► OpenClaw (18789)
```

### 4.3 Project File Structure

```
openclaw-mcp-termux/
├── src/
│   ├── index.ts              ← Entry point: detects stdio vs SSE, initialises bridge
│   ├── server.ts             ← MCP server definition, tool registry
│   ├── transport.ts          ← Transport factory: stdio or SSE based on env/flag
│   ├── gateway/
│   │   ├── client.ts         ← HTTP client wrapping OpenClaw gateway API calls
│   │   └── types.ts          ← Shared TypeScript interfaces for gateway responses
│   ├── tools/
│   │   ├── send.ts           ← tani_send, alan_send, rachel_send
│   │   ├── memory.ts         ← tani_memory_search, tani_memory_read
│   │   ├── sessions.ts       ← tani_sessions_list
│   │   └── status.ts         ← tani_agent_status, tani_workspace_ls
│   └── auth.ts               ← Token validation for SSE mode (simple Bearer, not OAuth initially)
├── scripts/
│   ├── start-tmux.sh         ← Launches server in a named tmux session with wake-lock
│   ├── stop-tmux.sh          ← Kills the tmux session cleanly
│   └── gen-token.sh          ← Generates a secure BRIDGE_TOKEN using openssl
├── docs/
│   ├── 01-prereqs.md         ← What to install in Termux before starting
│   ├── 02-local-stdio.md     ← Mode A setup: Claude Desktop / local MCP clients
│   ├── 03-remote-sse.md      ← Mode B setup: Claude.ai via cloudflared
│   ├── 04-tailscale.md       ← Alternative tunnel using Tailscale (openclaw.json already supports this)
│   └── 05-troubleshooting.md ← Common issues and fixes on Android
├── .env.example              ← Template for all environment variables
├── package.json
├── tsconfig.json
└── README.md
```

---

## 5. Environment Variables

Define these in `.env.example`. All must be documented with clear descriptions.

```bash
# === REQUIRED ===

# URL of your running OpenClaw gateway (never change this on Android - it's always loopback)
OPENCLAW_URL=http://127.0.0.1:18789

# Bearer token from your openclaw.json gateway.auth.token (found in ~/.openclaw/secrets.json)
OPENCLAW_GATEWAY_TOKEN=

# === SSE MODE ONLY (Mode B) ===

# Token that MCP clients use to authenticate to THIS bridge (generate with scripts/gen-token.sh)
BRIDGE_TOKEN=

# The public HTTPS URL of this bridge (your cloudflared or Tailscale URL)
# Required for SSE mode so OAuth metadata advertises the correct issuer
MCP_ISSUER_URL=

# Port for the SSE HTTP server (default: 3000)
PORT=3000

# === OPTIONAL ===

# Timeout in ms for OpenClaw gateway calls (default: 300000 = 5 minutes, matching Tani's response time)
OPENCLAW_TIMEOUT_MS=300000

# Set to 'true' to see verbose request/response logging (do not enable in production)
DEBUG=false
```

---

## 6. MCP Tools to Implement

Implement all of the following. Each section specifies the tool name, description (shown to the LLM in the MCP manifest), input schema, and what gateway endpoint to call.

### 6.1 `tani_send`

**Description for LLM manifest:** "Send a message to Tani (the main OpenClaw assistant) and return its response. Use this for any task you want to delegate to Tani: answering questions, performing research, managing files, running scripts, or any general assistant task."

**Input schema:**
```typescript
{
  message: string;           // Required. The message to send to Tani.
  session_id?: string;       // Optional. Resume a specific session by ID. If omitted, uses active session.
  timeout_ms?: number;       // Optional. Override default timeout. Default: OPENCLAW_TIMEOUT_MS.
}
```

**Gateway call:** `POST http://127.0.0.1:18789/command` with Bearer auth. Body: `{ agentId: "main", message, sessionId? }`. Return Tani's response text plus metadata (model, latency_ms, session_id used).

### 6.2 `alan_send`

**Description for LLM manifest:** "Send a coding task to Alan, the OpenClaw coding subagent. Alan specialises in writing, reviewing, debugging, and running code. Use this when the task requires code generation, file editing, bash execution, or technical implementation."

**Input schema:**
```typescript
{
  message: string;           // Required. The coding task description.
  session_id?: string;       // Optional.
  timeout_ms?: number;       // Optional.
}
```

**Gateway call:** Same as `tani_send` but `agentId: "coding"`.

### 6.3 `rachel_send`

**Description for LLM manifest:** "Send a document processing task to Rachel, the OpenClaw document agent. Rachel can read, write, summarise, and transform documents. Rachel does NOT have access to exec or process tools — she is read/write only."

**Input schema:**
```typescript
{
  message: string;           // Required. The document task.
  session_id?: string;       // Optional.
  timeout_ms?: number;       // Optional.
}
```

**Gateway call:** Same as `tani_send` but `agentId: "rachel"`.

### 6.4 `tani_memory_search`

**Description for LLM manifest:** "Semantically search across Tani's workspace memory. This searches all session memory files, daily vault notes (TaniVault), and any memory files that OpenClaw has created. Use this to find what Tani worked on in the past, retrieve context from previous sessions, or look up notes."

**Input schema:**
```typescript
{
  query: string;             // Required. Natural language search query.
  limit?: number;            // Optional. Max results to return. Default: 5.
}
```

**Gateway call:** `POST http://127.0.0.1:18789/memory/search` with Bearer auth. Body: `{ query, limit }`. Return array of matches with file path, excerpt, and relevance score.

### 6.5 `tani_memory_read`

**Description for LLM manifest:** "Read the full contents of a specific memory or vault file from Tani's workspace. Use the path returned by tani_memory_search to read a specific file in full."

**Input schema:**
```typescript
{
  path: string;              // Required. File path relative to workspace root, e.g. "memory/2026-03-07-session.md"
}
```

**Gateway call:** `POST http://127.0.0.1:18789/tools/read` with Bearer auth. Body: `{ path }`. The gateway enforces that the path is within the workspace — never outside. Return file content as string.

### 6.6 `tani_sessions_list`

**Description for LLM manifest:** "List recent and active sessions for any OpenClaw agent. Shows session IDs, the model used, when each session was last active, and any session flags. Use this to find a session ID if you want to resume a conversation."

**Input schema:**
```typescript
{
  agent_id?: "main" | "coding" | "rachel";  // Optional. Default: "main".
}
```

**Gateway call:** `GET http://127.0.0.1:18789/sessions?agentId=<agent_id>` with Bearer auth. Return list of sessions.

### 6.7 `tani_agent_status`

**Description for LLM manifest:** "Get the current health and status of the OpenClaw gateway and all configured agents. Returns gateway uptime, the active model for each agent, and whether the gateway is reachable."

**Input schema:** None (no parameters needed).

**Gateway call:** `GET http://127.0.0.1:18789/health` with Bearer auth. Return structured status object with per-agent info.

### 6.8 `tani_workspace_ls`

**Description for LLM manifest:** "List files and directories in Tani's workspace. Use this to explore what files are available before using tani_memory_read to read them."

**Input schema:**
```typescript
{
  path?: string;             // Optional. Subdirectory to list. Default: workspace root.
  recursive?: boolean;       // Optional. List recursively. Default: false.
}
```

**Gateway call:** `POST http://127.0.0.1:18789/tools/list_files` with Bearer auth. Body: `{ path, recursive }`. Return array of file entries with name, type (file/dir), size, and modified timestamp.

---

## 7. Gateway Client Implementation

This is the most important module. Implement it carefully.

### 7.1 `src/gateway/client.ts`

```typescript
// Pseudocode — implement this fully in TypeScript

class OpenClawGatewayClient {
  constructor(private baseUrl: string, private token: string, private timeoutMs: number) {}

  private async request(method: string, path: string, body?: object): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenClaw gateway error ${response.status}: ${errorText}`);
      }

      return response.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`OpenClaw gateway timeout after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Implement each gateway API method here...
  async sendCommand(agentId: string, message: string, sessionId?: string): Promise<CommandResponse> {}
  async searchMemory(query: string, limit?: number): Promise<MemorySearchResponse> {}
  async readFile(path: string): Promise<FileReadResponse> {}
  async listSessions(agentId?: string): Promise<SessionsResponse> {}
  async getHealth(): Promise<HealthResponse> {}
  async listFiles(path?: string, recursive?: boolean): Promise<FilesResponse> {}
}
```

**Critical implementation notes:**
- Use the built-in `fetch` from Node 22 — do NOT add `node-fetch` as a dependency
- The timeout must use `AbortController` — `setTimeout` on the fetch itself is not reliable
- All errors must be caught and re-thrown as structured MCP tool errors, never raw exceptions
- The gateway returns JSON for all endpoints — no streaming responses in the bridge itself
- The default timeout is 300,000ms (5 minutes) because Tani can take a long time on complex tasks and runs on a mobile device with variable connectivity

### 7.2 Error Handling Philosophy

When a gateway call fails, the bridge must return a structured MCP tool error rather than crashing. Format errors as:

```typescript
{
  ok: false,
  error: {
    code: "GATEWAY_UNREACHABLE" | "GATEWAY_TIMEOUT" | "GATEWAY_AUTH_FAILED" | "TOOL_ERROR",
    message: "Human-readable description of what went wrong",
    hint: "Actionable suggestion, e.g. 'Make sure OpenClaw is running: openclaw start'"
  }
}
```

Common error cases to handle explicitly:
- `ECONNREFUSED` on `http://127.0.0.1:18789` → gateway is not running → suggest `openclaw start`
- `401 Unauthorized` → wrong token → suggest checking `~/.openclaw/secrets.json`
- Timeout → Tani is processing something long → suggest increasing `OPENCLAW_TIMEOUT_MS`
- `ENOTFOUND` → wrong URL configured → check `OPENCLAW_URL` env var

---

## 8. Transport Layer

### 8.1 `src/transport.ts`

The transport mode is selected by checking:
1. If `--transport sse` flag is passed, or `TRANSPORT=sse` env var is set → SSE mode
2. If stdin is a TTY (i.e., running interactively, not piped from an MCP client) → SSE mode as fallback
3. Otherwise (default) → stdio mode

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport }   from '@modelcontextprotocol/sdk/server/sse.js';

export function createTransport(mode: 'stdio' | 'sse', options?: { port: number }) {
  if (mode === 'sse') {
    return new SSEServerTransport({ port: options?.port ?? 3000 });
  }
  return new StdioServerTransport();
}
```

### 8.2 Auth for SSE Mode

In SSE mode, protect the endpoint with a simple Bearer token check (not full OAuth 2.1 — that is a complexity that is unnecessary for a single-user personal deployment).

Every incoming SSE connection must include `Authorization: Bearer <BRIDGE_TOKEN>` in its headers. If the token is missing or wrong, return HTTP 401 immediately.

This is simpler than the freema OAuth 2.1 implementation and appropriate for a personal self-hosted tool. If users want OAuth later, it can be layered on top.

**Claude.ai compatibility note:** Claude.ai's custom MCP connector accepts a Bearer token in its configuration screen. This simple Bearer auth is fully compatible with how Claude.ai connects to custom MCP servers.

---

## 9. Process Persistence on Android (Critical)

Android will kill background processes when memory pressure increases or the screen locks. The user must use both of the following together.

### 9.1 `scripts/start-tmux.sh`

```bash
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
  "cd $(dirname "$0")/.. && node dist/index.js --transport sse 2>&1 | tee /tmp/openclaw-mcp.log"

echo "✅ openclaw-mcp-termux started in tmux session '$SESSION'"
echo ""
echo "To view logs:    tmux attach -t $SESSION"
echo "To stop:         bash scripts/stop-tmux.sh"
echo "To view log file: tail -f /tmp/openclaw-mcp.log"
```

### 9.2 `scripts/stop-tmux.sh`

```bash
#!/data/data/com.termux/files/usr/bin/bash
tmux kill-session -t "openclaw-mcp" 2>/dev/null && echo "✅ Stopped" || echo "Session was not running"
termux-wake-unlock
echo "✅ Wake lock released"
```

### 9.3 `scripts/gen-token.sh`

```bash
#!/data/data/com.termux/files/usr/bin/bash
# Generate a secure 32-byte hex token for BRIDGE_TOKEN
# Requires: pkg install openssl-tool
echo "Your BRIDGE_TOKEN:"
openssl rand -hex 32
```

---

## 10. `.env.example` and Configuration Loading

Use `dotenv` to load `.env` if present. Never crash if `.env` is missing — fall back to process environment variables. This allows the user to pass env vars in the tmux startup script or in their shell profile.

```typescript
// src/index.ts — configuration loading
import 'dotenv/config'; // loads .env if present, silently ignores if missing

const config = {
  gatewayUrl:   process.env.OPENCLAW_URL           ?? 'http://127.0.0.1:18789',
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?? '',
  bridgeToken:  process.env.BRIDGE_TOKEN           ?? '',
  issuerUrl:    process.env.MCP_ISSUER_URL          ?? '',
  port:         parseInt(process.env.PORT           ?? '3000', 10),
  timeoutMs:    parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? '300000', 10),
  debug:        process.env.DEBUG === 'true',
  transport:    (process.argv.includes('--transport') 
                  ? process.argv[process.argv.indexOf('--transport') + 1] 
                  : process.env.TRANSPORT ?? 'stdio') as 'stdio' | 'sse',
};

// Validate required config
if (!config.gatewayToken) {
  console.error('ERROR: OPENCLAW_GATEWAY_TOKEN is required. Set it in your .env file or environment.');
  process.exit(1);
}

if (config.transport === 'sse' && !config.bridgeToken) {
  console.error('ERROR: BRIDGE_TOKEN is required in SSE mode. Generate one with scripts/gen-token.sh');
  process.exit(1);
}
```

---

## 11. Package Configuration

### 11.1 `package.json`

```json
{
  "name": "openclaw-mcp-termux",
  "version": "0.1.0",
  "description": "MCP server bridge for OpenClaw — built for Android/Termux, no Docker required",
  "type": "module",
  "bin": {
    "openclaw-mcp-termux": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "start:sse": "node dist/index.js --transport sse"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "@types/node": "^22.0.0"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

**Dependency philosophy:** Keep dependencies minimal. Do not add `express`, `node-fetch`, `axios`, `ws`, or any other large library. Node 22 provides `fetch` natively. The MCP SDK handles all transport complexity. Every additional dependency is a Termux install risk.

### 11.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

---

## 12. README.md Requirements

The README must be structured for three distinct readers. Write it with clear section anchors.

### Section 1: Quick Start (for users who just want it working)

Show the minimum viable setup in under 10 commands. Assume the user has OpenClaw already running.

```bash
# 1. Prerequisites
pkg install tmux openssl-tool nodejs

# 2. Clone and install
git clone https://github.com/<user>/openclaw-mcp-termux
cd openclaw-mcp-termux
npm install && npm run build

# 3. Configure
cp .env.example .env
# Edit .env — set OPENCLAW_GATEWAY_TOKEN to your gateway token from ~/.openclaw/secrets.json

# 4. Start (local stdio mode — for Claude Desktop)
node dist/index.js
# OR start persistent SSE mode (for Claude.ai)
bash scripts/start-tmux.sh
```

### Section 2: How to Find Your Gateway Token

This is the single most confusing step for new users. Explain it clearly:

```bash
# Your gateway token is in your OpenClaw secrets file:
cat ~/.openclaw/secrets.json
# Look for the key that corresponds to gateway.auth.token in your openclaw.json
```

### Section 3: Connecting Claude.ai (SSE Mode)

Step-by-step with screenshots described:
1. Install and start cloudflared tunnel
2. Get your public HTTPS URL
3. Set `MCP_ISSUER_URL` to that URL in `.env`
4. Restart the bridge with `bash scripts/start-tmux.sh`
5. In Claude.ai → Settings → Integrations → Add custom connector
6. Enter `https://your-tunnel-url.trycloudflare.com`
7. Enter your `BRIDGE_TOKEN` when prompted

### Section 4: Connecting to Local MCP Clients (stdio Mode)

For Claude Desktop, Cursor, or any local MCP client:

```json
{
  "mcpServers": {
    "tani": {
      "command": "node",
      "args": ["/data/data/com.termux/files/home/openclaw-mcp-termux/dist/index.js"],
      "env": {
        "OPENCLAW_URL": "http://127.0.0.1:18789",
        "OPENCLAW_GATEWAY_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Section 5: Keeping It Running (Process Persistence)

Explain the Android-specific problem: processes die when screen locks. Explain the tmux + wake-lock solution. Explain how to check if it's running (`tmux ls`).

### Section 6: Cloudflared Setup on Termux

```bash
# Install cloudflared for ARM64
pkg install cloudflared
# OR download binary directly:
# curl -Lo cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
# chmod +x cloudflared && mv cloudflared $PREFIX/bin/

# Start a tunnel pointing to your bridge port
cloudflared tunnel --url http://127.0.0.1:3000
# This outputs a URL like: https://random-name.trycloudflare.com
# Use that URL as MCP_ISSUER_URL in your .env
```

### Section 7: Tailscale Alternative

```bash
# If you have Tailscale on your Android device:
# 1. Enable Tailscale in your openclaw.json gateway section:
#    "tailscale": { "mode": "on" }
# 2. Your gateway becomes reachable at your Tailscale IP
# 3. Run the bridge with:
#    OPENCLAW_URL=http://<tailscale-ip>:18789 node dist/index.js --transport sse
# 4. Claude.ai connects to http://<tailscale-ip>:3000
```

### Section 8: Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:18789` | OpenClaw gateway is not running | Run `openclaw start` in Termux |
| `401 Unauthorized` | Wrong gateway token | Check `OPENCLAW_GATEWAY_TOKEN` against `~/.openclaw/secrets.json` |
| Bridge killed after screen locks | Android killing background process | Use `bash scripts/start-tmux.sh` which sets `termux-wake-lock` |
| `Cannot find module` errors | Build not run | Run `npm run build` first |
| cloudflared URL changes on restart | Ephemeral tunnel | Use a named Cloudflare Tunnel for a stable URL (requires Cloudflare account) |
| Tool response timeout | Tani is slow (normal on mobile) | Increase `OPENCLAW_TIMEOUT_MS=600000` |

---

## 13. Implementation Order (Phased)

Build in this exact order. Do not skip ahead.

### Phase 1 — Stdio mode, core tools (build and test this first)

1. Set up TypeScript project, `package.json`, `tsconfig.json`
2. Implement `src/gateway/client.ts` with full error handling
3. Implement `src/gateway/types.ts` with TypeScript interfaces for all gateway responses
4. Implement `src/tools/status.ts` — `tani_agent_status` only (simplest tool, good smoke test)
5. Implement `src/server.ts` and `src/index.ts` with stdio transport only
6. Build and test: `OPENCLAW_GATEWAY_TOKEN=<token> node dist/index.js`
7. Add remaining tools: `tani_send`, `alan_send`, `rachel_send`
8. Add: `tani_sessions_list`
9. Add: `tani_memory_search`, `tani_memory_read`, `tani_workspace_ls`
10. Write `docs/02-local-stdio.md`

### Phase 2 — SSE mode and persistence

11. Implement `src/transport.ts` with SSE support
12. Implement `src/auth.ts` with Bearer token check for SSE connections
13. Wire SSE transport into `src/index.ts`
14. Write `scripts/start-tmux.sh`, `scripts/stop-tmux.sh`, `scripts/gen-token.sh`
15. Test SSE mode locally: `BRIDGE_TOKEN=test node dist/index.js --transport sse`
16. Write `docs/03-remote-sse.md` and `docs/04-tailscale.md`

### Phase 3 — Polish

17. Write `docs/01-prereqs.md` and `docs/05-troubleshooting.md`
18. Write complete `README.md`
19. Write `.env.example`
20. Verify everything builds cleanly on Node 22 with no warnings

---

## 14. Testing Approach

There is no test framework requirement, but you must verify these scenarios manually or with simple scripts:

**Scenario 1 — Connectivity check:**
```bash
OPENCLAW_GATEWAY_TOKEN=<token> OPENCLAW_URL=http://127.0.0.1:18789 \
  node dist/index.js --transport sse &
curl -H "Authorization: Bearer <token>" http://127.0.0.1:3000/health
```

**Scenario 2 — tani_agent_status smoke test via MCP inspector:**
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```
Then call `tani_agent_status` from the inspector UI. Verify it returns gateway uptime and agent models.

**Scenario 3 — Gateway unreachable error handling:**
Stop OpenClaw, then call any tool. Verify the response is a clean structured error, not a crash with a stack trace.

**Scenario 4 — Timeout handling:**
Set `OPENCLAW_TIMEOUT_MS=1000`. Call `tani_send` with a complex message. Verify you get a clean timeout error, not a hanging process.

---

## 15. Strict Constraints — Do Not Violate These

These are non-negotiable. Violating any of these will cause the project to fail on the target device.

1. **No Docker.** Not a single line of Dockerfile, docker-compose.yml, or documentation referencing Docker as a required step.
2. **No `host.docker.internal`.** Never use this hostname. The gateway is always `127.0.0.1`.
3. **No global npm installs required.** The project must work via local `node dist/index.js` or `npx`. A user who does not have root access cannot run `npm install -g` to a system location.
4. **No hardcoded Termux paths.** Paths like `/data/data/com.termux/files/home/` appear in documentation as examples only. Code must use `process.env.HOME` or relative paths.
5. **No `node-fetch`.** Node 22 has native `fetch`. Do not add this dependency.
6. **No `express` or `fastify`.** The MCP SDK handles HTTP. Do not add a web framework.
7. **No `ws` WebSocket library.** The gateway communicates via HTTP. The bridge does not need WebSocket.
8. **The default gateway URL must be `http://127.0.0.1:18789`** — not `localhost`, which can resolve to IPv6 `::1` and fail on some Android builds.
9. **Timeout default must be 300,000ms (5 minutes).** Tani runs on a mobile device on a variable API (NVIDIA NIM). Response times can be long. Never default to a short timeout.
10. **All scripts must use the Termux shebang line:** `#!/data/data/com.termux/files/usr/bin/bash` — NOT `/bin/bash` which does not exist on Android.

---

## 16. Context on the OpenClaw Config (For Reference)

This is the sanitised `openclaw.json` from the target device. Use it to understand agent IDs, model identifiers, and workspace paths. Do not hardcode any of these values in code — they are reference data only.

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "nvidia/moonshotai/kimi-k2.5" },
      "workspace": "/data/data/com.termux/files/home/.openclaw/workspace",
      "memorySearch": { "enabled": true, "extraPaths": ["./TaniVault"] }
    },
    "list": [
      { "id": "main",   "default": true },
      { "id": "coding", "workspace": "/data/data/com.termux/files/home/.openclaw/workspace-coding" },
      { "id": "rachel", "workspace": "/data/data/com.termux/files/home/.openclaw/workspace-rachel",
        "tools": { "deny": ["exec","process","sessions_spawn","cron","gateway","elevated"] } }
    ]
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": { "mode": "token" },
    "tailscale": { "mode": "off" }
  }
}
```

Key takeaways:
- `rachel` agent has `exec` and `process` denied — she cannot run shell commands. Do not document `rachel_send` as suitable for code execution tasks.
- Tailscale is configured but off (`"mode": "off"`). The docs should explain how to enable it.
- The gateway only binds to loopback — it is **never** directly reachable from the internet.
- The primary model is `moonshotai/kimi-k2.5` via NVIDIA NIM. Response times are variable.

---

## 17. What Success Looks Like

The project is complete when:

1. A user with an existing OpenClaw installation on Android/Termux can clone this repo, set two environment variables, run `npm run build && node dist/index.js`, and successfully call `tani_agent_status` from an MCP inspector.
2. A user can run `bash scripts/start-tmux.sh`, set up `cloudflared`, and have Claude.ai on the web connect to their Tani instance and use all 8 tools.
3. The README is readable by a non-developer OpenClaw user — no assumed knowledge of MCP internals or TypeScript.
4. The project has zero runtime dependencies beyond `@modelcontextprotocol/sdk` and `dotenv`.
5. No Docker reference appears anywhere in the project.

---

*End of agent prompt. Begin implementation at Phase 1, Step 1.*
