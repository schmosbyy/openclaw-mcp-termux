import { OpenClawGatewayClient } from '../gateway/client.js';

export const sessionsTool = {
    name: 'tani_sessions_list',
    description: 'List recent and active sessions for the Tani orchestrator. Shows session IDs, the model used, and when each session was last active. Use this to find a session ID to resume an ongoing execution plan.',
    inputSchema: {
        type: 'object',
        properties: {
            agent_id: {
                type: 'string',
                description: 'Optional agent ID. Defaults to "main" (Tani).',
            }
        },
        required: []
    }
};

export async function handleSessionsList(client: OpenClawGatewayClient, input: any) {
    const agent_id = input.agent_id || 'main';

    try {
        const list = await client.listSessions(agent_id);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(list, null, 2)
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
