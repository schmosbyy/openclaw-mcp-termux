import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { CurrentActionsResponse, ActiveProcess, RecentToolCall } from '../gateway/types.js';

const execAsync = promisify(exec);
const HOME = os.homedir();
const AGENTS_DIR = path.join(HOME, '.openclaw', 'agents');
const AGENT_IDS = ['main', 'alan', 'rachel']; // known agent IDs; extend as needed
const ACTIVE_THRESHOLD_SECONDS = 90;

export const currentActionsTool = {
    name: 'tani_current_actions',
    description: 'Check whether Tani (or any OpenClaw agent) is currently busy. Returns active OS processes, recently-modified sessions, last tool calls from those sessions, and a gateway log tail. Call this BEFORE tani_send to avoid double-triggering a running task.',
    inputSchema: {
        type: 'object',
        properties: {
            log_lines: {
                type: 'number',
                description: 'Number of gateway log lines to include. Default: 20.',
                default: 20
            }
        },
        required: []
    }
};

export async function handleCurrentActions(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const logLines = Math.min(input.log_lines ?? 20, 100);
    const now = Date.now();

    try {
        // --- 1. Scan all agents for recently-modified session JSONLs ---
        const recentlyActiveSessions: CurrentActionsResponse['recently_active_sessions'] = [];
        const recentToolCalls: RecentToolCall[] = [];

        for (const agentId of AGENT_IDS) {
            const sessionsJsonPath = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
            let sessionsData: Record<string, any> = {};

            try {
                const raw = await fs.readFile(sessionsJsonPath, 'utf-8');
                sessionsData = JSON.parse(raw);
            } catch {
                continue; // agent doesn't exist or no sessions
            }

            for (const [sessionKey, entry] of Object.entries(sessionsData)) {
                if (!entry || typeof entry !== 'object') continue;
                const sessionId: string = entry.sessionId || '';
                if (!sessionId) continue;

                const jsonlPath = path.join(AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`);

                let mtime: number | null = null;
                try {
                    const stat = await fs.stat(jsonlPath);
                    mtime = stat.mtimeMs;
                } catch {
                    continue;
                }

                const secondsAgo = Math.round((now - mtime) / 1000);
                if (secondsAgo <= ACTIVE_THRESHOLD_SECONDS) {
                    recentlyActiveSessions.push({
                        sessionKey,
                        agentId,
                        sessionId,
                        lastModifiedSecondsAgo: secondsAgo
                    });

                    // Read last 10 lines of JSONL to find recent tool calls
                    try {
                        const stat = await fs.stat(jsonlPath);
                        const readSize = Math.min(stat.size, 8192); // last 8KB
                        const position = Math.max(0, stat.size - readSize);
                        const fh = await fs.open(jsonlPath, 'r');
                        try {
                            const buf = Buffer.alloc(readSize);
                            await fh.read(buf, 0, readSize, position);
                            const lines = buf.toString('utf-8').split('\n').filter(Boolean).slice(-10);
                            for (const line of lines.reverse()) {
                                try {
                                    const parsed = JSON.parse(line);
                                    // JSONL entries with tool use blocks look for role=assistant with content array
                                    const content = parsed?.message?.content;
                                    if (Array.isArray(content)) {
                                        const toolUse = content.find((b: any) => b.type === 'tool_use');
                                        if (toolUse) {
                                            recentToolCalls.push({
                                                sessionKey,
                                                agentId,
                                                toolName: toolUse.name || 'unknown',
                                                toolInput: toolUse.input
                                                    ? JSON.stringify(toolUse.input).slice(0, 200)
                                                    : undefined,
                                                timestamp: parsed.timestamp || null
                                            });
                                            break; // one per session is enough
                                        }
                                    }
                                } catch {
                                    // not valid JSON, skip line
                                }
                            }
                        } finally {
                            await fh.close();
                        }
                    } catch {
                        // can't read JSONL, skip tool call extraction
                    }
                }
            }
        }

        // --- 2. Get active processes ---
        const activeProcesses: ActiveProcess[] = [];
        try {
            const { stdout } = await execAsync(
                "ps aux | grep -E '(node|npm|git|openclaw)' | grep -v grep | awk '{print $1,$2,$3,$4,substr($0,index($0,$11))}'",
                { timeout: 5000 }
            );
            for (const line of stdout.trim().split('\n').filter(Boolean)) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 5) {
                    activeProcesses.push({
                        pid: parts[1],
                        command: parts.slice(4).join(' ').slice(0, 120),
                        cpu: parts[2],
                        mem: parts[3]
                    });
                }
            }
        } catch {
            // ps failed, ignore
        }

        // --- 3. Read gateway log tail ---
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
                    } finally {
                        await fh.close();
                    }
                    break;
                } catch {
                    continue;
                }
            }
        } catch {
            // no log found
        }

        // --- 4. Determine idle state ---
        const isIdle = recentlyActiveSessions.length === 0 && activeProcesses.length === 0;

        const result: CurrentActionsResponse = {
            is_idle: isIdle,
            idle_reason: isIdle
                ? `No sessions modified in last ${ACTIVE_THRESHOLD_SECONDS}s and no openclaw/npm processes found`
                : undefined,
            active_processes: activeProcesses,
            recently_active_sessions: recentlyActiveSessions,
            recent_tool_calls: recentToolCalls,
            gateway_log_tail: gatewayLogTail,
            checked_at: new Date().toISOString()
        };

        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };

    } catch (err: any) {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: err.code || 'UNKNOWN', message: err.message } }, null, 2) }]
        };
    }
}
