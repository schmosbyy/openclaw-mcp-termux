import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const HOME = os.homedir();
const AGENTS_DIR = path.join(HOME, '.openclaw', 'agents');
const AGENT_IDS = ['main', 'coding', 'rachel']; // FIXED: was ['main', 'alan', 'rachel']
const ACTIVE_THRESHOLD_SECONDS = 90;

export const agentQueryTool = {
    name: 'agent_query',
    description: 'Multi-view agent observation. Consolidates health checks, session listings, activity monitoring, and log access into a single tool.\n' +
        '- "health": gateway reachability (~38ms)\n' +
        '- "sessions": all agent sessions with metadata from sessions.json + JSONL\n' +
        '- "actions": active processes, recently-modified sessions, recent tool calls, log tail\n' +
        '- "logs": gateway/command/heartbeat log scenarios\n' +
        '- "history": JSONL transcript read for a specific session',
    inputSchema: {
        type: 'object',
        properties: {
            view: {
                type: 'string',
                enum: ['health', 'sessions', 'actions', 'logs', 'history'],
                description: 'Which observation view to return.'
            },
            agent_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Agent IDs to check. Default: ["main", "coding", "rachel"].'
            },
            active_only: {
                type: 'boolean',
                description: '[sessions/actions] Only return recently-active sessions. Default: false.'
            },
            scenario: {
                type: 'string',
                enum: ['gateway', 'gateway_errors', 'commands', 'heartbeat', 'rclone', 'health'],
                description: '[logs] Log scenario to fetch.'
            },
            tail: {
                type: 'number',
                description: '[logs/actions] Number of lines to return. Default: 50, max: 200.',
                default: 50
            },
            session_key: {
                type: 'string',
                description: '[history] Session key to read transcript for.'
            },
            log_lines: {
                type: 'number',
                description: '[actions] Number of gateway log lines. Default: 20.',
                default: 20
            }
        },
        required: ['view']
    }
};

export async function handleAgentQuery(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const view = input.view;

    switch (view) {
        case 'health':
            return handleHealthView(client);
        case 'sessions':
            return handleSessionsView(input);
        case 'actions':
            return handleActionsView(input);
        case 'logs':
            return handleLogsView(input);
        case 'history':
            return handleHistoryView(input);
        default:
            return { isError: true, content: [{ type: 'text', text: `Unknown view: ${view}` }] };
    }
}

// ─── Health View ────────────────────────────────────────────────────────

async function handleHealthView(client: OpenClawGatewayClient) {
    try {
        const health = await client.getHealth();
        return { content: [{ type: 'text', text: JSON.stringify(health, null, 2) }] };
    } catch (err: any) {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({
                ok: false,
                error: { code: err.code || 'UNKNOWN_ERROR', message: err.message, hint: err.hint }
            }, null, 2) }]
        };
    }
}

// ─── Sessions View ──────────────────────────────────────────────────────

async function handleSessionsView(input: any) {
    const agentIds: string[] = input.agent_ids || AGENT_IDS;
    const activeOnly: boolean = input.active_only ?? false;
    const now = Date.now();
    const allSessions: any[] = [];

    for (const agentId of agentIds) {
        const sessionsJsonPath = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
        let sessionsData: Record<string, any> = {};

        try {
            const raw = await fs.readFile(sessionsJsonPath, 'utf-8');
            sessionsData = JSON.parse(raw);
        } catch {
            continue;
        }

        for (const [sessionKey, entry] of Object.entries(sessionsData)) {
            if (!entry || typeof entry !== 'object') continue;
            const sessionId: string = entry.sessionId || '';
            if (!sessionId) continue;

            const jsonlPath = path.join(AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`);
            let secondsAgo: number | null = null;
            let lineCount: number | null = null;
            let lastToolCall: string | null = null;
            let isRecentlyActive = false;

            try {
                const stat = await fs.stat(jsonlPath);
                secondsAgo = Math.round((now - stat.mtimeMs) / 1000);
                isRecentlyActive = secondsAgo <= ACTIVE_THRESHOLD_SECONDS;

                const readSize = Math.min(stat.size, 16384);
                const position = Math.max(0, stat.size - readSize);
                const fh = await fs.open(jsonlPath, 'r');
                try {
                    const buf = Buffer.alloc(readSize);
                    await fh.read(buf, 0, readSize, position);
                    const lines = buf.toString('utf-8').split('\n').filter(Boolean);
                    lineCount = position === 0 ? lines.length : null;

                    for (const line of lines.reverse()) {
                        try {
                            const parsed = JSON.parse(line);
                            const content = parsed?.message?.content;
                            if (Array.isArray(content)) {
                                const toolUse = content.find((b: any) => b.type === 'tool_use');
                                if (toolUse?.name) {
                                    lastToolCall = toolUse.name;
                                    break;
                                }
                            }
                        } catch { continue; }
                    }
                } finally {
                    await fh.close();
                }
            } catch {
                // JSONL doesn't exist yet
            }

            if (!activeOnly || isRecentlyActive) {
                allSessions.push({
                    sessionKey,
                    sessionId,
                    agentId,
                    updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : 'unknown',
                    lastModifiedSecondsAgo: secondsAgo,
                    is_recently_active: isRecentlyActive,
                    chatType: entry.chatType || 'unknown',
                    compactionCount: entry.compactionCount ?? 0,
                    abortedLastRun: entry.abortedLastRun ?? false,
                    is_subagent: sessionKey.includes(':subagent:'),
                    last_tool_call: lastToolCall,
                    jsonl_line_count: lineCount
                });
            }
        }
    }

    allSessions.sort((a, b) => {
        if (a.is_recently_active !== b.is_recently_active) return a.is_recently_active ? -1 : 1;
        return (a.lastModifiedSecondsAgo ?? Infinity) - (b.lastModifiedSecondsAgo ?? Infinity);
    });

    return {
        content: [{ type: 'text', text: JSON.stringify({
            ok: true,
            view: 'sessions',
            agents_checked: agentIds,
            sessions: allSessions,
            total: allSessions.length
        }, null, 2) }]
    };
}

// ─── Actions View ───────────────────────────────────────────────────────

async function handleActionsView(input: any) {
    const logLines = Math.min(input.log_lines ?? 20, 100);
    const now = Date.now();

    try {
        const recentlyActiveSessions: any[] = [];
        const recentToolCalls: any[] = [];

        for (const agentId of AGENT_IDS) {
            const sessionsJsonPath = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
            let sessionsData: Record<string, any> = {};
            try {
                const raw = await fs.readFile(sessionsJsonPath, 'utf-8');
                sessionsData = JSON.parse(raw);
            } catch { continue; }

            for (const [sessionKey, entry] of Object.entries(sessionsData)) {
                if (!entry || typeof entry !== 'object') continue;
                const sessionId: string = entry.sessionId || '';
                if (!sessionId) continue;

                const jsonlPath = path.join(AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`);
                let mtime: number | null = null;
                try {
                    const stat = await fs.stat(jsonlPath);
                    mtime = stat.mtimeMs;
                } catch { continue; }

                const secondsAgo = Math.round((now - mtime) / 1000);
                if (secondsAgo <= ACTIVE_THRESHOLD_SECONDS) {
                    recentlyActiveSessions.push({ sessionKey, agentId, sessionId, lastModifiedSecondsAgo: secondsAgo });

                    try {
                        const stat = await fs.stat(jsonlPath);
                        const readSize = Math.min(stat.size, 8192);
                        const position = Math.max(0, stat.size - readSize);
                        const fh = await fs.open(jsonlPath, 'r');
                        try {
                            const buf = Buffer.alloc(readSize);
                            await fh.read(buf, 0, readSize, position);
                            const lines = buf.toString('utf-8').split('\n').filter(Boolean).slice(-10);
                            for (const line of lines.reverse()) {
                                try {
                                    const parsed = JSON.parse(line);
                                    const content = parsed?.message?.content;
                                    if (Array.isArray(content)) {
                                        const toolUse = content.find((b: any) => b.type === 'tool_use');
                                        if (toolUse) {
                                            recentToolCalls.push({
                                                sessionKey, agentId,
                                                toolName: toolUse.name || 'unknown',
                                                toolInput: toolUse.input ? JSON.stringify(toolUse.input).slice(0, 200) : undefined,
                                                timestamp: parsed.timestamp || null
                                            });
                                            break;
                                        }
                                    }
                                } catch { continue; }
                            }
                        } finally { await fh.close(); }
                    } catch { /* can't read JSONL */ }
                }
            }
        }

        // Active processes
        const activeProcesses: any[] = [];
        try {
            const { stdout } = await execAsync(
                "ps aux | grep -E '(node|npm|git|openclaw)' | grep -v grep | awk '{print $1,$2,$3,$4,substr($0,index($0,$11))}'",
                { timeout: 5000 }
            );
            for (const line of stdout.trim().split('\n').filter(Boolean)) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 5) {
                    activeProcesses.push({ pid: parts[1], command: parts.slice(4).join(' ').slice(0, 120), cpu: parts[2], mem: parts[3] });
                }
            }
        } catch { /* ps failed */ }

        // Gateway log tail
        const gatewayLogTail: string[] = [];
        try {
            const homeEntries = await fs.readdir(HOME);
            const today = new Date().toISOString().slice(0, 10);
            for (const entry of homeEntries) {
                if (!entry.startsWith('openclaw-')) continue;
                const candidate = path.join(HOME, entry, `openclaw-${today}.log`);
                try {
                    const stat = await fs.stat(candidate);
                    const readSize = Math.min(stat.size, 8192);
                    const position = Math.max(0, stat.size - readSize);
                    const fh = await fs.open(candidate, 'r');
                    try {
                        const buf = Buffer.alloc(readSize);
                        await fh.read(buf, 0, readSize, position);
                        const lines = buf.toString('utf-8').split('\n').filter(Boolean).slice(-logLines);
                        gatewayLogTail.push(...lines.map(l => l
                            .replace(/nvapi-[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
                            .replace(/Bearer [A-Za-z0-9_.-]+/ig, 'Bearer [REDACTED]')
                        ));
                    } finally { await fh.close(); }
                    break;
                } catch { continue; }
            }
        } catch { /* no log */ }

        const isIdle = recentlyActiveSessions.length === 0 && activeProcesses.length === 0;

        return {
            content: [{ type: 'text', text: JSON.stringify({
                ok: true,
                view: 'actions',
                is_idle: isIdle,
                idle_reason: isIdle ? `No sessions modified in last ${ACTIVE_THRESHOLD_SECONDS}s and no openclaw/npm processes found` : undefined,
                active_processes: activeProcesses,
                recently_active_sessions: recentlyActiveSessions,
                recent_tool_calls: recentToolCalls,
                gateway_log_tail: gatewayLogTail,
                checked_at: new Date().toISOString()
            }, null, 2) }]
        };
    } catch (err: any) {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: err.code || 'UNKNOWN', message: err.message } }, null, 2) }]
        };
    }
}

// ─── Logs View ──────────────────────────────────────────────────────────

async function handleLogsView(input: any) {
    const scenario = input.scenario;
    if (!scenario || !['gateway', 'gateway_errors', 'commands', 'heartbeat', 'rclone', 'health'].includes(scenario)) {
        return { isError: true, content: [{ type: 'text', text: 'scenario is required and must be one of: gateway, gateway_errors, commands, heartbeat, rclone, health' }] };
    }

    const tail = Math.min(input.tail ?? 50, 200);
    let resultText = '';

    if (scenario === 'gateway' || scenario === 'gateway_errors') {
        const logPath = await getMostRecentGatewayLog();
        if (!logPath) {
            resultText = 'No gateway logs found in proot /tmp/openclaw';
        } else {
            let lines = await readTailLines(logPath, 5000);
            lines = lines.map(l => stripAnsi(redactTokens(l)));
            if (scenario === 'gateway_errors') {
                lines = lines.filter(l => l.includes('ERROR') || l.includes('WARN'));
            }
            lines = lines.slice(-tail);
            resultText = `// source: ${logPath}\n${lines.join('\n')}`;
        }
    } else if (scenario === 'commands') {
        const logPath = path.join(HOME, '.openclaw', 'logs', 'commands.log');
        const lines = await readTailLines(logPath, tail);
        resultText = `// source: ${logPath}\n${lines.map(redactTokens).join('\n')}`;
    } else if (scenario === 'rclone') {
        const logPath = path.join(HOME, 'tmp', 'rclone-backup.log');
        const lines = await readTailLines(logPath, tail);
        resultText = `// source: ${logPath}\n${lines.map(redactTokens).join('\n')}`;
    } else if (scenario === 'heartbeat') {
        const today = new Date().toISOString().slice(0, 10);
        const dailyNotePath = path.join(HOME, '.openclaw', 'workspace', 'TaniVault', 'Daily', `${today}.md`);
        const workspaceDir = path.join(HOME, '.openclaw', 'workspace');
        const rcloneLog = path.join(HOME, 'tmp', 'rclone-backup.log');

        const [dailyNote, gitLog, rcloneTail] = await Promise.all([
            fs.readFile(dailyNotePath, 'utf-8').catch(e => e.code === 'ENOENT' ? `[File not found: ${dailyNotePath}]` : `[Error: ${e.message}]`),
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
    } else if (scenario === 'health') {
        try {
            const response = await fetch('http://localhost:18789/health');
            resultText = response.ok ? await response.text() : `HTTP Error: ${response.status} ${response.statusText}`;
        } catch (err: any) {
            resultText = `Fetch error: ${err.message}`;
        }
    }

    return { content: [{ type: 'text', text: resultText }] };
}

// ─── History View ───────────────────────────────────────────────────────

async function handleHistoryView(input: any) {
    const sessionKey = input.session_key;
    if (!sessionKey) {
        return { isError: true, content: [{ type: 'text', text: 'session_key is required for history view' }] };
    }

    // Try to find the session across all agents
    for (const agentId of AGENT_IDS) {
        const sessionsJsonPath = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
        try {
            const raw = await fs.readFile(sessionsJsonPath, 'utf-8');
            const sessionsData = JSON.parse(raw);
            const entry = sessionsData[sessionKey];
            if (!entry || !entry.sessionId) continue;

            const jsonlPath = path.join(AGENTS_DIR, agentId, 'sessions', `${entry.sessionId}.jsonl`);

            const tail = Math.min(input.tail ?? 100, 200);
            const lines = await readTailLines(jsonlPath, tail);

            return {
                content: [{ type: 'text', text: JSON.stringify({
                    ok: true,
                    view: 'history',
                    sessionKey,
                    agentId,
                    sessionId: entry.sessionId,
                    lines: lines.length,
                    transcript: lines.join('\n')
                }, null, 2) }]
            };
        } catch { continue; }
    }

    return { isError: true, content: [{ type: 'text', text: `Session not found: ${sessionKey}` }] };
}

// ─── Shared Helpers ─────────────────────────────────────────────────────

async function readTailLines(filePath: string, lines: number): Promise<string[]> {
    try {
        const stat = await fs.stat(filePath);
        const readSize = Math.min(stat.size, 100 * 1024);
        const position = Math.max(0, stat.size - readSize);
        const fh = await fs.open(filePath, 'r');
        try {
            const buf = Buffer.alloc(readSize);
            await fh.read(buf, 0, readSize, position);
            let content = buf.toString('utf-8');
            if (position > 0) {
                const firstNewline = content.indexOf('\n');
                if (firstNewline !== -1) content = content.substring(firstNewline + 1);
            }
            return content.split('\n').filter(Boolean).slice(-lines);
        } finally {
            await fh.close();
        }
    } catch (err: any) {
        if (err.code === 'ENOENT') return [`File not found: ${filePath}`];
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
                } catch { continue; }
            }
        }
        return newestFile;
    } catch {
        return null;
    }
}
