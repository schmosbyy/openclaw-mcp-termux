export const sendTool = {
    name: 'tani_send',
    description: 'Send a detailed plan or message to Tani, the OpenClaw orchestrator. Tani will use your plan to execute tasks by delegating to specialized subagents (Alan for coding, Rachel for documents) or doing internal searches. The message should contain structured steps and full context. Only call this tool when the user has explicitly requested execution (e.g. "do it", "send it", "execute"). If the user asks for a plan, prompt, or artifact — produce that output instead. Do not call speculatively.',
    inputSchema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The detailed plan or message to send to Tani.'
            }
        },
        required: ['message']
    }
};

export async function handleSend(_client: any, input: any) {
    const { message } = input;
    
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

    try {
        const response = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'x-openclaw-token': secret
            },
            body: JSON.stringify({
                message,
                agentId: 'main',
                wakeMode: 'now'
            })
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
