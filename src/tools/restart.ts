import { OpenClawGatewayClient } from '../gateway/client.js';

// Rate limiting: max 3 restarts per 10 minutes
const RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const restartLog: number[] = [];

export const restartTool = {
    name: 'openclaw_gateway_restart',
    description: 'Note: Remote restart is not supported for this setup. The gateway runs in a physical Termux terminal. This tool will return instructions for manual restart.',
    inputSchema: {
        type: 'object',
        properties: {
            json: {
                type: 'boolean',
                default: true
            }
        },
        required: []
    }
};

export async function handleRestart(client: OpenClawGatewayClient, input: any) {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                ok: false,
                status: 'manual_required',
                message: 'The OpenClaw gateway runs inside a physical Termux terminal session and cannot be restarted remotely. Please restart it manually in Termux by stopping the current session and running: ~/bin/openclaw-proot.sh',
                hint: 'If you need to apply a config change, most changes hot-reload automatically within seconds without a restart.'
            }, null, 2)
        }]
    };
}
