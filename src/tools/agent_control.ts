import { OpenClawGatewayClient } from '../gateway/client.js';

export const agentControlTool = {
    name: 'agent_control',
    description: 'Control running agent sessions: abort stuck agents, steer them in a new direction, compact their context, or reset them. ' +
        'Uses the gateway /tools/invoke API. If the gateway does not support a given action, returns a clear error with CLI fallback instructions.',
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['abort', 'steer', 'compact', 'reset'],
                description: 'Session control action to perform.'
            },
            sessionKey: {
                type: 'string',
                description: 'The session key to control.'
            },
            message: {
                type: 'string',
                description: 'Required for "steer" — the new direction or instruction to inject.'
            }
        },
        required: ['action', 'sessionKey']
    }
};

const TOOL_MAP: Record<string, string> = {
    abort: 'sessions_abort',
    steer: 'sessions_steer',
    compact: 'sessions_compact',
    reset: 'sessions_reset',
};

export async function handleAgentControl(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const action = input.action;
    const sessionKey = input.sessionKey;

    if (!action || !TOOL_MAP[action]) {
        return { isError: true, content: [{ type: 'text', text: `action must be one of: abort, steer, compact, reset` }] };
    }
    if (!sessionKey) {
        return { isError: true, content: [{ type: 'text', text: 'sessionKey is required' }] };
    }
    if (action === 'steer' && !input.message) {
        return { isError: true, content: [{ type: 'text', text: 'message is required for steer action' }] };
    }

    const toolName = TOOL_MAP[action];
    const args: Record<string, any> = { sessionKey };
    if (action === 'steer') args.message = input.message;

    const result = await client.invokeTool(toolName, args);

    if (!result.ok) {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({
                ok: false,
                action,
                sessionKey,
                error: result.error,
                fallback: `Gateway does not support "${action}" via HTTP. Try: ssh proot "openclaw sessions ${action} ${sessionKey}"`
            }, null, 2) }]
        };
    }

    return {
        content: [{ type: 'text', text: JSON.stringify({
            ok: true,
            action,
            sessionKey,
            result: result.result
        }, null, 2) }]
    };
}
