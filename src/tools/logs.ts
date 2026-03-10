import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

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
    let limit = input.limit ?? 100;
    if (limit > 500) limit = 500;
    const json = input.json ?? true;
    const level = input.level;

    const logPath = path.join(os.homedir(), '.openclaw', 'logs', 'commands.log');

    try {
        let fileStat;
        try {
            fileStat = await stat(logPath);
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return {
                    content: [{
                        type: 'text',
                        text: `Log file not found at ${logPath}. Gateway may not have written logs yet.`
                    }]
                };
            }
            throw err;
        }

        let fileHandle;
        let content = '';
        try {
            fileHandle = await fs.open(logPath, 'r');
            // If file is > 5MB, read only the last 5MB.
            const MAX_BYTES = 5 * 1024 * 1024;
            const size = fileStat.size;
            const readSize = Math.min(size, MAX_BYTES);
            const position = size > MAX_BYTES ? size - MAX_BYTES : 0;
            const buffer = Buffer.alloc(readSize);
            await fileHandle.read(buffer, 0, readSize, position);
            content = buffer.toString('utf-8');
            if (position > 0) {
                // we might have started mid-line, chop off the first partial line
                const firstNewlineIndex = content.indexOf('\n');
                if (firstNewlineIndex !== -1) {
                    content = content.substring(firstNewlineIndex + 1);
                }
            }
        } finally {
            if (fileHandle) {
                await fileHandle.close();
            }
        }

        let lines = content.split('\n');
        // Ignore potentially empty last line if file ends in newline
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        // Apply level filter
        if (level) {
            const levelSearch = `[${level.toLowerCase()}]`;
            lines = lines.filter(line => line.toLowerCase().includes(levelSearch));
        }

        // Slice last N lines
        lines = lines.slice(-limit);

        // Process lines and scrub secrets
        const processedLines = lines.map(line => {
            if (json) {
                let result;
                try {
                    result = JSON.parse(line);
                } catch (e) {
                    result = { raw: line, ts: null };
                }

                if (result !== null && typeof result === 'object') {
                    if (typeof result.message === 'string') {
                        result.message = result.message.replace(/nvapi-[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]');
                        result.message = result.message.replace(/Bearer [A-Za-z0-9_\.-]+/ig, 'Bearer [REDACTED_TOKEN]');
                    }
                    if (result.context) {
                        let ctxStr = typeof result.context === 'string' ? result.context : JSON.stringify(result.context);
                        const scrubbed = ctxStr
                            .replace(/nvapi-[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
                            .replace(/Bearer [A-Za-z0-9_\.-]+/ig, 'Bearer [REDACTED_TOKEN]');
                        try {
                            result.context = JSON.parse(scrubbed);
                        } catch (e) {
                            result.context = scrubbed;
                        }
                    }
                }
                return JSON.stringify(result);
            } else {
                return line
                    .replace(/nvapi-[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
                    .replace(/Bearer [A-Za-z0-9_\.-]+/ig, 'Bearer [REDACTED_TOKEN]');
            }
        });

        const headerLevel = level ? level : "all";
        const header = `// source: ${logPath} | lines: ${processedLines.length} | level: ${headerLevel}`;

        let finalText = header + (processedLines.length > 0 ? ('\n' + processedLines.join('\n')) : '');

        if (input.follow) {
            finalText += '\n// (Live tail not supported in MCP snapshot mode)';
        }

        return {
            content: [{
                type: 'text',
                text: finalText
            }]
        };

    } catch (err: any) {
        return {
            isError: true,
            content: [{
                type: 'text',
                text: JSON.stringify({
                    ok: false,
                    error: {
                        code: err.code || 'UNKNOWN_ERROR',
                        message: err.message,
                        hint: err.hint
                    }
                }, null, 2)
            }]
        };
    }
}
