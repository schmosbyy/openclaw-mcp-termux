import { OpenClawGatewayClient } from '../gateway/client.js';

export const logsTool = {
    name: 'openclaw_logs',
    description: 'Fetch recent OpenClaw gateway logs to debug tool failures and connection issues.',
    inputSchema: {
        type: 'object',
        properties: {
            limit: {
                type: 'number',
                description: 'Number of recent lines to fetch.',
                default: 100
            },
            json: {
                type: 'boolean',
                description: 'Returns line-delimited JSON log events.',
                default: true
            },
            level: {
                type: 'string',
                description: 'Filter by log level: "error", "warn", "info", "debug"',
            },
            follow: {
                type: 'boolean',
                description: 'Tail in real time. (Ignored for MCP snapshots)',
                default: false
            }
        },
        required: []
    }
};

export async function handleLogs(client: OpenClawGatewayClient, input: any) {
    const limit = input.limit ?? 100;
    const json = input.json ?? true;
    const level = input.level;
    // follow is intentionally ignored for MCP

    try {
        const response = await client.getLogs(limit, json, level);

        // Scrub secrets from log lines before returning them
        if (response.lines) {
            for (const line of response.lines) {
                if (line.message) {
                    line.message = line.message.replace(/nvapi-[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]');
                    line.message = line.message.replace(/Bearer [A-Za-z0-9_\.-]+/ig, 'Bearer [REDACTED_TOKEN]');
                }

                // Scrub inside context too if string
                if (line.context) {
                    const ctxStr = JSON.stringify(line.context);
                    const scrubbed = ctxStr
                        .replace(/nvapi-[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
                        .replace(/Bearer [A-Za-z0-9_\.-]+/ig, 'Bearer [REDACTED_TOKEN]');
                    line.context = JSON.parse(scrubbed);
                }
            }
        }

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
