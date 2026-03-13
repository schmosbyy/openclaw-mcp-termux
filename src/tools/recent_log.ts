import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const HOME = os.homedir();

export const recentLogTool = {
    name: 'tani_recent_log',
    description: 'Return the last N lines of the real OpenClaw gateway log (stderr/errors/crashes). Unlike openclaw_logs which may fall back to session lifecycle events, this tool ONLY reads the real PID-keyed gateway log at ~/openclaw-{PID}/openclaw-YYYY-MM-DD.log. Returns null log_path if gateway has never started.',
    inputSchema: {
        type: 'object',
        properties: {
            lines: {
                type: 'number',
                description: 'Number of lines to return. Default: 50, max: 200.',
                default: 50
            }
        },
        required: []
    }
};

export async function handleRecentLog(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const lines = Math.min(input.lines ?? 50, 200);
    const today = new Date().toISOString().slice(0, 10);

    try {
        // Find the real gateway log — PID-keyed directory
        let logPath: string | null = null;
        try {
            const homeEntries = await fs.readdir(HOME);
            for (const entry of homeEntries) {
                if (!entry.startsWith('openclaw-')) continue;
                // Verify it's a PID dir (digits only after prefix)
                const suffix = entry.replace('openclaw-', '');
                if (!/^\d+$/.test(suffix)) continue;
                const candidate = path.join(HOME, entry, `openclaw-${today}.log`);
                try {
                    await fs.stat(candidate);
                    logPath = candidate;
                    break;
                } catch {
                    continue;
                }
            }
        } catch {
            // readdir failed
        }

        if (!logPath) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        log_path: null,
                        lines_returned: 0,
                        content: [],
                        note: `No gateway log found at ~/openclaw-{PID}/openclaw-${today}.log. Gateway may not have been started today, or PID directory was cleaned up.`
                    }, null, 2)
                }]
            };
        }

        const stat = await fs.stat(logPath);
        const readSize = Math.min(stat.size, 1024 * 100); // max 100KB read
        const position = Math.max(0, stat.size - readSize);
        const fh = await fs.open(logPath, 'r');
        let content: string[] = [];

        try {
            const buf = Buffer.alloc(readSize);
            await fh.read(buf, 0, readSize, position);
            let text = buf.toString('utf-8');
            if (position > 0) {
                const firstNewline = text.indexOf('\n');
                if (firstNewline !== -1) text = text.substring(firstNewline + 1);
            }
            content = text.split('\n').filter(Boolean).slice(-lines)
                .map(l => l
                    .replace(/nvapi-[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
                    .replace(/Bearer [A-Za-z0-9_.-]+/ig, 'Bearer [REDACTED]')
                );
        } finally {
            await fh.close();
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    log_path: logPath,
                    lines_returned: content.length,
                    content
                }, null, 2)
            }]
        };

    } catch (err: any) {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: err.code || 'UNKNOWN', message: err.message } }, null, 2) }]
        };
    }
}
