import { OpenClawGatewayClient } from '../gateway/client.js';

// Rate limiting: max 3 restarts per 10 minutes
const RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const restartLog: number[] = [];

export const restartTool = {
    name: 'openclaw_gateway_restart',
    description: 'Restart the OpenClaw gateway service. Use this after doctor --fix if a restart is needed, or for degraded states.',
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
    const json = input.json ?? true;

    // Enforce rate limiting
    const now = Date.now();

    // Remove old logs
    while (restartLog.length > 0 && restartLog[0] < now - RESTART_WINDOW_MS) {
        restartLog.shift();
    }

    if (restartLog.length >= RESTART_LIMIT) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'failed',
                        message: `Rate limit exceeded: Please wait before restarting the gateway again. (Max ${RESTART_LIMIT} times per 10 minutes).`
                    }, null, 2)
                }
            ]
        };
    }

    try {
        const response = await client.restartGateway(json);

        // Record this restart
        restartLog.push(now);

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(response, null, 2)
                }
            ]
        };
    } catch (err: any) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        error: {
                            code: err.code || 'UNKNOWN_ERROR',
                            message: err.message,
                            hint: err.hint
                        }
                    }, null, 2)
                }
            ]
        };
    }
}
