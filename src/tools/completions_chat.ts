import { OpenAIChatCompletionResponse } from '../gateway/types.js';

export const completionsChatTool = {
    name: 'completions_chat',
    description: 'Send a message to an agent and get its reply synchronously using the chat completions endpoint.',
    inputSchema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The prompt to send'
            },
            agentId: {
                type: 'string',
                enum: ['main', 'coding', 'rachel'],
                description: 'Which agent to send the message to (default: main)'
            },
            maxTokens: {
                type: 'number',
                description: 'Max tokens for the reply (default: 1000)'
            },
            timeoutMs: {
                type: 'number',
                description: 'Client-side abort timeout in ms (default: 300000)'
            }
        },
        required: ['message']
    }
};

export async function handleCompletionsChat(_client: any, input: any) {
    const {
        message,
        agentId = 'main',
        maxTokens = 1000,
        timeoutMs = 300000
    } = input;
    
    const token = process.env.OPENCLAW_GATEWAY_TOKEN;
    if (!token) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        error: {
                            code: 'CONFIG_ERROR',
                            message: 'OPENCLAW_GATEWAY_TOKEN is not configured in the environment.'
                        }
                    }, null, 2)
                }
            ]
        };
    }

    const baseUrl = (process.env.OPENCLAW_URL || 'http://127.0.0.1:18789').replace(/\/$/, '');
    const url = `${baseUrl}/v1/chat/completions`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const payload = {
        model: `openclaw/${agentId}`,
        messages: [{ role: 'user', content: message }],
        max_tokens: maxTokens
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
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

        const data = await response.json() as OpenAIChatCompletionResponse;
        
        let content = '';
        let finishReason = '';
        if (data.choices && data.choices.length > 0) {
            content = data.choices[0].message?.content || '';
            finishReason = data.choices[0].finish_reason || '';
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: true,
                        agentId,
                        reply: content,
                        finishReason
                    }, null, 2)
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
