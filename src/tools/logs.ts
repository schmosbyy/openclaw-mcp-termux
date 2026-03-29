import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import * as util from 'node:util';

const execAsync = util.promisify(exec);

export const logsTool = {
    name: 'openclaw_logs',
    description: 'Fetch openclaw gateway logs, session commands, or heartbeat data into a single tool.',
    inputSchema: {
        type: 'object',
        properties: {
            scenario: {
                type: 'string',
                enum: ['gateway', 'gateway_errors', 'commands', 'heartbeat', 'rclone', 'health'],
                description: 'The log scenario to fetch:\n- "gateway": real gateway log, ANSI-stripped, secrets redacted\n- "gateway_errors": same log, filtered to ERROR or WARN\n- "commands": session lifecycle events\n- "heartbeat": Daily note + git log + rclone log\n- "rclone": rclone backup log\n- "health": HTTP health check endpoint'
            },
            tail: {
                type: 'number',
                description: 'Lines to return. Default 50, max 200. Ignored for "health".',
                default: 50
            }
        },
        required: ['scenario']
    }
};

async function readTailLines(filePath: string, lines: number): Promise<string[]> {
    try {
        const stat = await fs.stat(filePath);
        const readSize = Math.min(stat.size, 1024 * 100); // max 100KB read
        const position = Math.max(0, stat.size - readSize);
        const fh = await fs.open(filePath, 'r');
        let content = '';

        try {
            const buf = Buffer.alloc(readSize);
            await fh.read(buf, 0, readSize, position);
            content = buf.toString('utf-8');
            if (position > 0) {
                const firstNewline = content.indexOf('\n');
                if (firstNewline !== -1) content = content.substring(firstNewline + 1);
            }
            return content.split('\n').filter(Boolean).slice(-lines);
        } finally {
            await fh.close();
        }
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            return [`File not found: ${filePath}`];
        }
        return [`Error reading ${filePath}: ${err.message}`];
    }
}

function redactTokens(text: string): string {
    return text
        .replace(/nvapi-[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
        .replace(/Bearer [A-Za-z0-9_.-]+/ig, 'Bearer [REDACTED]');
}

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}

async function getMostRecentGatewayLog(): Promise<string | null> {
    const PROOT_LOG_DIR = '/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu/tmp/openclaw';
    try {
        const files = await fs.readdir(PROOT_LOG_DIR);
        let newestFile: string | null = null;
        let newestMtime = 0;

        for (const file of files) {
            if (file.startsWith('openclaw-') && file.endsWith('.log')) {
                const fullPath = path.join(PROOT_LOG_DIR, file);
                try {
                    const stats = await fs.stat(fullPath);
                    if (stats.mtimeMs > newestMtime) {
                        newestMtime = stats.mtimeMs;
                        newestFile = fullPath;
                    }
                } catch {
                    // Ignore stat errors for individual files
                }
            }
        }
        return newestFile;
    } catch {
        return null; // Dir doesn't exist or can't be read
    }
}

export async function handleLogs(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    try {
        const scenario = input.scenario;
        if (!['gateway', 'gateway_errors', 'commands', 'heartbeat', 'rclone', 'health'].includes(scenario)) {
             return {
                 isError: true,
                 content: [{ type: 'text', text: `Invalid scenario: ${scenario}` }]
             };
        }

        const tail = Math.min(input.tail ?? 50, 200);
        const home = os.homedir();

        let resultText = '';

        if (scenario === 'gateway' || scenario === 'gateway_errors') {
            const logPath = await getMostRecentGatewayLog();
            if (!logPath) {
                resultText = `No gateway logs found in /data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu/tmp/openclaw`;
            } else {
                let lines = await readTailLines(logPath, 5000); // Read a generous tail to allow filtering
                lines = lines.map(l => stripAnsi(redactTokens(l)));
                
                if (scenario === 'gateway_errors') {
                    lines = lines.filter(l => l.includes('ERROR') || l.includes('WARN'));
                }
                
                lines = lines.slice(-tail);
                resultText = `// source: ${logPath}\n${lines.join('\n')}`;
            }
        } 
        else if (scenario === 'commands') {
            const logPath = path.join(home, '.openclaw', 'logs', 'commands.log');
            const lines = await readTailLines(logPath, tail);
            resultText = `// source: ${logPath}\n${lines.map(redactTokens).join('\n')}`;
        }
        else if (scenario === 'rclone') {
            const logPath = path.join(home, 'tmp', 'rclone-backup.log');
            const lines = await readTailLines(logPath, tail);
            resultText = `// source: ${logPath}\n${lines.map(redactTokens).join('\n')}`;
        }
        else if (scenario === 'heartbeat') {
            const today = new Date().toISOString().slice(0, 10);
            const dailyNotePath = path.join(home, '.openclaw', 'workspace', 'TaniVault', 'Daily', `${today}.md`);
            const workspaceDir = path.join(home, '.openclaw', 'workspace');
            const rcloneLog = path.join(home, 'tmp', 'rclone-backup.log');

            const [dailyNote, gitLog, rcloneTail] = await Promise.all([
                fs.readFile(dailyNotePath, 'utf-8').catch(e => {
                    if (e.code === 'ENOENT') return `[File not found: ${dailyNotePath}]`;
                    return `[Error reading: ${e.message}]`;
                }),
                execAsync('git log --oneline -5', { cwd: workspaceDir }).then(r => r.stdout).catch(e => `[Git error: ${e.message}]`),
                readTailLines(rcloneLog, 20).then(lines => lines.join('\n'))
            ]);

            resultText = [
                `--- TANI VAULT DAILY NOTE (${today}) ---`,
                dailyNote,
                `\n--- WORKSPACE GIT LOG ---`,
                gitLog.trimEnd(),
                `\n--- RCLONE BACKUP LOG (LAST 20 LINES) ---`,
                rcloneTail
            ].join('\n');
        }
        else if (scenario === 'health') {
            try {
                // Ignore Node.js fetch type definitions complaining here
                // It works on Node 18+ globally
                const response = await fetch('http://localhost:18789/health');
                if (!response.ok) {
                    resultText = `HTTP Error: ${response.status} ${response.statusText}`;
                } else {
                    const text = await response.text();
                    resultText = text;
                }
            } catch (err: any) {
                resultText = `Fetch error: ${err.message}`;
            }
        }

        return {
            content: [{
                type: 'text',
                text: resultText
            }]
        };

    } catch (err: any) {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: err.code || 'UNKNOWN', message: err.message } }, null, 2) }]
        };
    }
}
