export const sendTool = {
    name: 'tani_send',
    description: 'Send a detailed plan or message to an OpenClaw agent. Can route to Tani (main - orchestrator), Alan (coding), or Rachel (rachel - documents). Setting deliver: true with channel: "telegram" and to: "8098495952" causes the agent to reply directly in Telegram via their own bot. The message should contain structured steps and full context. Only call this tool when the user has explicitly requested execution. Do not call speculatively.',
    inputSchema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The detailed plan or message to send.'
            },
            agentId: {
                type: 'string',
                enum: ['main', 'coding', 'rachel'],
                description: 'Which agent to route to. Defaults to main.'
            },
            wakeMode: {
                type: 'string',
                enum: ['now', 'next-heartbeat'],
                description: 'When to wake the agent. Defaults to now.'
            },
            name: {
                type: 'string',
                description: 'Name for log traceability.'
            },
            sessionKey: {
                type: 'string',
                description: 'Session key to target a specific session.'
            },
            deliver: {
                type: 'boolean',
                description: 'Whether to deliver the response to a channel.'
            },
            channel: {
                type: 'string',
                description: 'Delivery channel (e.g., telegram).'
            },
            to: {
                type: 'string',
                description: 'Recipient ID for delivery.'
            },
            model: {
                type: 'string',
                description: 'Model override for the agent.'
            },
            timeoutSeconds: {
                type: 'number',
                description: 'Timeout in seconds for processing.'
            }
        },
        required: ['message']
    }
};

export async function handleSend(_client: any, input: any) {
    const {
        message,
        agentId = 'main',
        wakeMode = 'now',
        name,
        sessionKey,
        deliver,
        channel,
        to,
        model,
        timeoutSeconds
    } = input;
    
    const secret = process.env.OPENCLAW_HOOK_SECRET;
    if (!secret) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        error: {
                            code: 'CONFIG_ERROR',
                            message: 'OPENCLAW_HOOK_SECRET is not configured in the environment.'
                        }
                    }, null, 2)
                }
            ]
        };
    }

    const baseUrl = (process.env.OPENCLAW_URL || 'http://127.0.0.1:18789').replace(/\/$/, '');
    const url = `${baseUrl}/hooks/agent`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const payload: Record<string, any> = { message, agentId, wakeMode };
    if (name !== undefined) payload.name = name;
    if (sessionKey !== undefined) payload.sessionKey = sessionKey;
    if (deliver !== undefined) payload.deliver = deliver;
    if (channel !== undefined) payload.channel = channel;
    if (to !== undefined) payload.to = to;
    if (model !== undefined) payload.model = model;
    if (timeoutSeconds !== undefined) payload.timeoutSeconds = timeoutSeconds;

    try {
        const response = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'x-openclaw-token': secret
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            let errorMsg = `HTTP ${response.status}`;
            try { errorMsg = await response.text(); } catch { }
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            ok: false,
                            error: {
                                code: 'HTTP_ERROR',
                                message: errorMsg
                            }
                        }, null, 2)
                    }
                ]
            };
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ ok: true, status: 'accepted' }, null, 2)
                }
            ]
        };
    } catch (err: any) {
        let code = err.code || 'UNKNOWN_ERROR';
        if (err.name === 'AbortError') code = 'TIMEOUT_ERROR';
        if (err.message && err.message.includes('fetch failed')) code = 'NETWORK_ERROR';

        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        error: {
                            code,
                            message: err.message
                        }
                    }, null, 2)
                }
            ]
        };
    } finally {
        clearTimeout(timeout);
    }
}
