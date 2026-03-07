import { OpenClawGatewayClient } from '../gateway/client.js';

export const sendTool = {
    name: 'tani_send',
    description: 'Send a detailed plan or message to Tani, the OpenClaw orchestrator. You are Claude Opus 4.6, the primary planner. Tani will use your plan to execute tasks by delegating to specialized subagents (Alan for coding, Rachel for documents) or doing internal searches. The message should contain structured steps and full context.',
    inputSchema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The detailed plan or message to send to Tani.'
            },
            session_id: {
                type: 'string',
                description: 'Optional. Resume a specific session by ID. If omitted, uses active session.'
            },
            timeout_ms: {
                type: 'number',
                description: 'Optional. Override default timeout for long-running plans (in ms).'
            }
        },
        required: ['message']
    }
};

export async function handleSend(client: OpenClawGatewayClient, input: any) {
    const { message, session_id, timeout_ms } = input;

    if (timeout_ms && Number.isFinite(timeout_ms)) {
        // If the input provides a longer timeout, we create a temporary client instance just for this request.
        client = new OpenClawGatewayClient((client as any).baseUrl, (client as any).token, timeout_ms);
    }

    try {
        const response = await client.sendCommand('main', message, session_id);
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
