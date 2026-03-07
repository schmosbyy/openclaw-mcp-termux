# Alternative: Tailscale

If you don't want to use Cloudflare Tunnels (or find `.trycloudflare.com` domains unreliable because they change), you can use Tailscale.

## Setup
1. **Find your Tailscale IP**
   If you have the Tailscale app installed on your Android device, find your Tailnet IP (e.g. `100.123.45.67`).
2. **Setup Tailscale in openclaw.json**
   You don't *need* OpenClaw Gateway to bind to tailscale natively (it binds to loopback locally), but this ensures your Android device itself is on the VPN.
3. **Run your MCP Server in HTTP mode**
   ```bash
   PORT=3000 node dist/index.js --transport http
   ```
4. **Point your clients to Tailscale**
   Any device on your Tailnet (like your Mac running Claude Desktop) can simply address your MCP Bridge at:
   `http://100.123.45.67:3000`
   
**Note:** Claude.ai *cannot* reach your Tailscale IP because it is a private network. Tailscale is an alternative only for clients that run on your own devices (like Claude Desktop or Cursor) where you don't want to run the bridge locally but want to talk to the bridge running remotely.
