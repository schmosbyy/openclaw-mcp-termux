# openclaw-mcp-termux

An MCP (Model Context Protocol) server that runs natively on Android via Termux, acting as a secure bridge between Claude.ai (or local clients) and your locally-running OpenClaw assistant.

## Features
- **No Docker Required**: Runs natively in Termux (Node.js).
- **Orchestrator Pattern**: Exposes a single `tani_send` tool so Claude Opus orchestrates tasks through Tani.
- **Dual Transport Mode**: 
  - `stdio` for local clients (Claude Desktop, Cursor).
  - `Streamable HTTP` for remote web clients (Claude.ai) via Cloudflare Tunnel.
- **Secure**: Uses Bearer token authentication for remote connections.

---

## 🚀 Quick Start (Local stdio mode)

This setup is for when you want to use the MCP locally on the same device with an MCP client (like Cursor).

1. **Install Prerequisites in Termux**
   ```bash
   pkg install nodejs git tmux openssl-tool
   ```

2. **Clone & Build**
   ```bash
   git clone https://github.com/yourusername/openclaw-mcp-termux.git
   cd openclaw-mcp-termux
   npm install && npm run build
   ```

3. **Configure**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set your `OPENCLAW_GATEWAY_TOKEN`. Find your token by running:
   ```bash
   cat ~/.openclaw/secrets.json
   ```

4. **Add to your MCP Client config**
   ```json
   {
     "mcpServers": {
       "openclaw": {
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

---

## 🌐 Connecting Claude.ai (Remote HTTP mode)

If you want to use Claude.ai on the web to talk to your Android's OpenClaw, you need to expose this bridge via a tunnel and run it persistently.

1. **Generate a Bridge Token**
   Run `./scripts/gen-token.sh` and add the 32-byte token to your `.env` as `BRIDGE_TOKEN`.

2. **Start the Persistent Server**
   ```bash
   bash scripts/start-tmux.sh
   ```
   *This starts the server on port 3000 in a tmux session and prevents Android from killing it.*

3. **Expose via Cloudflare Tunnel**
   ```bash
   pkg install cloudflared
   cloudflared tunnel --url http://127.0.0.1:3000
   ```
   *Copy the `trycloudflare.com` URL printed.*

4. **Connect Claude.ai**
   - Go to Claude.ai Settings → Integrations → Add custom connector
   - Enter your Cloudflare Tunnel URL.
   - Enter your `BRIDGE_TOKEN` when prompted.

---

## Available Tools

- **`tani_send`**: Send a structured plan or message to the Tani orchestrator. Tani executes the plan by delegating to its specialized subagents (Alan for code, Rachel for docs) or searching internal memory.
- **`tani_sessions_list`**: List recent Tani sessions to find context or resume past conversations.
- **`tani_agent_status`**: Check if the OpenClaw gateway is alive and routing properly.

---

## Technical Docs

- [01. Prerequisites](docs/01-prereqs.md)
- [02. Local stdio setup](docs/02-local-stdio.md)
- [03. Remote HTTP setup](docs/03-remote-http.md)
- [04. Tailscale Alternative](docs/04-tailscale.md)
- [05. Troubleshooting](docs/05-troubleshooting.md)
