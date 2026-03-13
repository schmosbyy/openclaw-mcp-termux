import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { SessionsDetailResponse, SessionDetail } from '../gateway/types.js';

const HOME = os.homedir();
const AGENTS_DIR = path.join(HOME, '.openclaw', 'agents');
const AGENT_IDS = ['main', 'alan', 'rachel'];
const ACTIVE_THRESHOLD_SECONDS = 90;

export const sessionsDetailTool = {
    name: 'tani_sessions_detail',
    description: 'Enriched session list for all OpenClaw agents. Shows which sessions are currently active (JSONL modified in last 90s), whether a session is a subagent, the last tool called, and JSONL line count. Use this to understand the full agent activity tree before sending messages.',
    inputSchema: {
        type: 'object',
        properties: {
            agent_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Agent IDs to check. Defaults to ["main", "alan", "rachel"].'
            },
            active_only: {
                type: 'boolean',
                description: 'If true, return only recently-active sessions. Default: false.',
                default: false
            }
        },
        required: []
    }
};

export async function handleSessionsDetail(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const agentIds: string[] = input.agent_ids || AGENT_IDS;
    const activeOnly: boolean = input.active_only ?? false;
    const now = Date.now();
    const allSessions: SessionDetail[] = [];

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

                // Count lines and extract last tool call from end of file
                const readSize = Math.min(stat.size, 16384); // last 16KB
                const position = Math.max(0, stat.size - readSize);
                const fh = await fs.open(jsonlPath, 'r');
                try {
                    const buf = Buffer.alloc(readSize);
                    await fh.read(buf, 0, readSize, position);
                    const lines = buf.toString('utf-8').split('\n').filter(Boolean);
                    // Rough line count (accurate if we read the whole file)
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
                        } catch {
                            continue;
                        }
                    }
                } finally {
                    await fh.close();
                }
            } catch {
                // JSONL file doesn't exist yet
            }

            const detail: SessionDetail = {
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
            };

            if (!activeOnly || isRecentlyActive) {
                allSessions.push(detail);
            }
        }
    }

    // Sort: recently active first, then by updatedAt desc
    allSessions.sort((a, b) => {
        if (a.is_recently_active !== b.is_recently_active) {
            return a.is_recently_active ? -1 : 1;
        }
        return (a.lastModifiedSecondsAgo ?? Infinity) - (b.lastModifiedSecondsAgo ?? Infinity);
    });

    const response: SessionsDetailResponse = {
        agents_checked: agentIds,
        sessions: allSessions,
        total: allSessions.length
    };

    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}
