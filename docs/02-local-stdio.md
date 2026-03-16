# Local stdio setup

If you are using Claude Desktop, Cursor, or another MCP client running natively on the **same Android device**, you can use the `stdio` transport.

This is the default mode. It sends MCP commands over standard input/output.

## 1. Start OpenClaw Gateway
Ensure OpenClaw is running inside your proot-Ubuntu environment:
```bash
openclaw-proot.sh gateway
```
*Note: Run this in a persistent tmux session so it stays alive.*

## 2. Locate your gateway token
Your OpenClaw gateway token is located in your `.openclaw` directory:
```bash
grep OPENCLAW_GATEWAY_TOKEN ~/.openclaw/.env
```

## 3. Configure your MCP Client

Your client needs to invoke the MCP server. Pass your gateway token via environment variables.

### Example for Claude Desktop / Cursor
Create/edit your configuration file (usually `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "openclaw-tani": {
      "command": "/data/data/com.termux/files/usr/bin/node",
      "args": ["/data/data/com.termux/files/home/openclaw-mcp-termux/dist/index.js"],
      "env": {
        "OPENCLAW_URL": "http://127.0.0.1:18789",
        "OPENCLAW_GATEWAY_TOKEN": "your-secret-gateway-token"
      }
    }
  }
}
```

## Troubleshooting
- **Cannot retrieve token**: Ensure `openclaw` ran at least once to generate the files.
- **Client stuck connecting**: Run `node dist/index.js` in your terminal manually. If it prints nothing and waits for input, it's working. If it crashes, read the error message.
