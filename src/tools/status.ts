import { OpenClawGatewayClient } from '../gateway/client.js';

export const agentStatusTool = {
    name: 'tani_agent_status',
    description: 'Get the current health and status of the OpenClaw gateway and orchestrator. Returns gateway uptime, the active model, and whether the gateway is reachable.',
    inputSchema: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function handleAgentStatus(client: OpenClawGatewayClient) {
    try {
        const health = await client.getHealth();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(health, null, 2)
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
