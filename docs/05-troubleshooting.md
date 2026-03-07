# Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| `Cannot find module` on start | Code is uncompiled | Run `npm run build` |
| Server dies after screen lock | Android process killing | Always run via `bash scripts/start-tmux.sh` which claims a `termux-wake-lock`. |
| `GATEWAY_AUTH_FAILED` | Wrong OpenClaw Gateway Token | Check `cat ~/.openclaw/secrets.json` and ensure it matches the `OPENCLAW_GATEWAY_TOKEN` inside `.env`. |
| `GATEWAY_UNREACHABLE` | Gateway not running | Ensure `openclaw start` has been executed on the phone. |
| Claude.ai `HTTP 401 Unauthorized` | Bridge Token Mismatch | Check the Custom connector config in Claude.ai and ensure it matches your `.env` `BRIDGE_TOKEN`. |
| Tool Timeout | Default 5 mins exceeded | Mobile inference via NVIDIA NIM taking too long. Increase `OPENCLAW_TIMEOUT_MS` in `.env`. |
| cloudflared URL changed | restart of process | Use a registered Cloudflare domain (requires a Cloudflare account) instead of an ephemeral `.trycloudflare` one to stop URL rotation. |
