import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const recentLogTool = {
    name: 'tani_recent_log',
    description: 'Return the last N lines of the real OpenClaw gateway log (stderr/errors/crashes). Reads from the proot-Ubuntu tmp directory at the confirmed path. Unlike openclaw_logs which reads only session lifecycle events, this reads the full gateway error log.',
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
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    try {
        const PROOT_LOG_DIR = '/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu/tmp/openclaw';
        let logPath: string | null = null;
        
        const todayPath = path.join(PROOT_LOG_DIR, `openclaw-${today}.log`);
        const yesterdayPath = path.join(PROOT_LOG_DIR, `openclaw-${yesterday}.log`);

        try {
            await fs.stat(todayPath);
            logPath = todayPath;
        } catch {
            try {
                await fs.stat(yesterdayPath);
                logPath = yesterdayPath;
            } catch {
                logPath = null;
            }
        }

        if (!logPath) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        log_path: null,
                        lines_returned: 0,
                        content: [],
                        note: `Log file not found for today (${today}) or yesterday (${yesterday}) in ${PROOT_LOG_DIR}. The gateway may not have written errors recently.`
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
