import { OpenClawGatewayClient } from '../gateway/client.js';

export const agentDispatchTool = {
    name: 'agent_dispatch',
    description: 'Send a task or message to an OpenClaw agent. Three modes:\n' +
        '- "async" (default): fire-and-forget via webhook. Returns immediately with accepted status. Supports delivery to Telegram.\n' +
        '- "sync": wait for agent reply via chat completions. Blocks until response.\n' +
        '- "spawn": tracked sub-agent delegation via /sessions_spawn. Returns runId + childSessionKey for observation.\n' +
        'Routes to Tani (main), Alan (coding), or Rachel (rachel). Only call when the user has explicitly requested execution.',
    inputSchema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The task, plan, or message to send.'
            },
            agentId: {
                type: 'string',
                enum: ['main', 'coding', 'rachel'],
                description: 'Target agent. main=Tani (orchestrator), coding=Alan (code), rachel=Rachel (documents). Default: main.'
            },
            mode: {
                type: 'string',
                enum: ['async', 'sync', 'spawn'],
                description: 'Dispatch mode. "async" = fire-and-forget, "sync" = wait for reply, "spawn" = tracked delegation. Default: async.'
            },
            // async mode options (passthrough to /hooks/agent)
            deliver: {
                type: 'boolean',
                description: '[async] Whether to deliver the response to a channel.'
            },
            channel: {
                type: 'string',
                description: '[async] Delivery channel (e.g., "telegram").'
            },
            to: {
                type: 'string',
                description: '[async] Recipient ID for delivery.'
            },
            wakeMode: {
                type: 'string',
                enum: ['now', 'next-heartbeat'],
                description: '[async] When to wake the agent. Default: now.'
            },
            name: {
                type: 'string',
                description: '[async] Name for log traceability.'
            },
            sessionKey: {
                type: 'string',
                description: '[async] Session key to target a specific session.'
            },
            // sync mode options
            maxTokens: {
                type: 'number',
                description: '[sync] Max tokens for the reply. Default: 1000.'
            },
            timeoutMs: {
                type: 'number',
                description: '[sync] Client-side abort timeout in ms. Default: 300000.'
            },
            // spawn mode options
            runTimeoutSeconds: {
                type: 'number',
                description: '[spawn] Timeout for the sub-agent run in seconds.'
            },
            // shared options
            model: {
                type: 'string',
                description: 'Override the agent\'s default model.'
            },
            timeoutSeconds: {
                type: 'number',
                description: '[async] Timeout in seconds for processing.'
            }
        },
        required: ['message']
    }
};

export async function handleAgentDispatch(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const {
        message,
        agentId = 'main',
        mode = 'async',
        // async options
        deliver,
        channel,
        to,
        wakeMode = 'now',
        name,
        sessionKey,
        // sync options
        maxTokens = 1000,
        timeoutMs = 300000,
        // spawn options
        runTimeoutSeconds,
        // shared
        model,
        timeoutSeconds,
    } = input;

    if (mode === 'async') {
        // ─── Fire-and-forget via /hooks/agent ────────────────────────
        const payload: Record<string, any> = { message, agentId, wakeMode };
        if (name !== undefined) payload.name = name;
        if (sessionKey !== undefined) payload.sessionKey = sessionKey;
        if (deliver !== undefined) payload.deliver = deliver;
        if (channel !== undefined) payload.channel = channel;
        if (to !== undefined) payload.to = to;
        if (model !== undefined) payload.model = model;
        if (timeoutSeconds !== undefined) payload.timeoutSeconds = timeoutSeconds;

        const result = await client.sendToAgent(payload);

        if (!result.ok) {
            return {
                isError: true,
                content: [{ type: 'text', text: JSON.stringify({ ok: false, mode: 'async', error: result.error }, null, 2) }]
            };
        }

        return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: 'async', agentId, status: result.status }, null, 2) }]
        };
    }

    if (mode === 'sync') {
        // ─── Synchronous reply via /v1/chat/completions ──────────────
        const result = await client.chatCompletions(
            agentId,
            [{ role: 'user', content: message }],
            { maxTokens, timeoutMs }
        );

        if (!result.ok) {
            return {
                isError: true,
                content: [{ type: 'text', text: JSON.stringify({ ok: false, mode: 'sync', error: result.error }, null, 2) }]
            };
        }

        return {
            content: [{ type: 'text', text: JSON.stringify({
                ok: true,
                mode: 'sync',
                agentId,
                reply: result.reply,
                finishReason: result.finishReason
            }, null, 2) }]
        };
    }

    if (mode === 'spawn') {
        // ─── Tracked delegation via /sessions_spawn ──────────────────
        const opts: Record<string, any> = {};
        if (model) opts.model = model;
        if (runTimeoutSeconds) opts.runTimeoutSeconds = runTimeoutSeconds;

        const result = await client.spawnSession(message, { agentId, ...opts });

        if (!result.ok) {
            return {
                isError: true,
                content: [{ type: 'text', text: JSON.stringify({ ok: false, mode: 'spawn', error: result.error }, null, 2) }]
            };
        }

        return {
            content: [{ type: 'text', text: JSON.stringify({
                ok: true,
                mode: 'spawn',
                agentId,
                status: result.status,
                runId: result.runId,
                childSessionKey: result.childSessionKey
            }, null, 2) }]
        };
    }

    return {
        isError: true,
        content: [{ type: 'text', text: `Unknown mode: ${mode}. Must be "async", "sync", or "spawn".` }]
    };
}
