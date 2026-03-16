# OpenClaw MCP Observability Tools — LLM Coding IDE Prompt

## MISSION

You are building **4 new observability MCP tools** on top of the existing `openclaw-mcp-termux` TypeScript project. These tools solve a real production problem: a human operator couldn't tell that an OpenClaw agent was mid-task (running an npm install), sent a second instruction, and nearly triggered a double-upgrade. The tools give the operator instant, zero-reasoning-cost visibility into what the agent is doing before they act.

**Do not refactor existing code. Only add new files and extend `src/server.ts` and `src/gateway/types.ts`.**

---

## PHASE 0 — UNDERSTAND THE CODEBASE BEFORE WRITING A SINGLE LINE

Read these files in order before touching anything:

1. `src/gateway/types.ts` — all TypeScript interfaces
2. `src/gateway/client.ts` — `OpenClawGatewayClient` class; note `listSessions()` reads disk directly, not HTTP
3. `src/server.ts` — how tools are registered (import tool + handler, add to `ListToolsRequestSchema`, add `case` to `CallToolRequestSchema`)
4. `src/tools/logs.ts` — the most complex existing tool; this is the gold standard for file-reading tools. Study the 5MB tail pattern, the PID-keyed directory scan, and the token-redaction logic
5. `src/tools/sessions.ts` — how session data is read from `sessions.json`
6. `src/tools/shell_exec.ts` — the exact env setup pattern for Termux (PATH injection, NODE_OPTIONS glibc-compat patch)

**The existing tool file pattern is:**
```typescript
// 1. Export a tool definition object
export const myTool = { name: '...', description: '...', inputSchema: { ... } };

// 2. Export a handler function
export async function handleMyTool(client: OpenClawGatewayClient, input: any) {
    // ... implementation
    return { content: [{ type: 'text', text: '...' }] };
    // OR on error:
    return { isError: true, content: [{ type: 'text', text: '...' }] };
}
```

---

## PHASE 1 — KEY CONSTANTS AND PATHS (ANDROID/TERMUX SPECIFIC)

All tools must use these paths. Never hardcode `/home/user` or `/root`.

```typescript
const HOME = process.env.HOME || '/data/data/com.termux/files/home';
const OPENCLAW_DIR = path.join(HOME, '.openclaw');
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
```

**Real gateway log** (stderr, crashes, all errors):
```typescript
// Scan HOME for dirs matching /openclaw-\d+/ — these are PID-keyed gateway working dirs
// Inside each: openclaw-YYYY-MM-DD.log
// This is the same logic already in src/tools/logs.ts — reuse it
```

**Session JSONL files** (one per session, append-only turn log):
```typescript
path.join(AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`)
```

**Sessions index** (all sessions for an agent):
```typescript
path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json')
```

**Openclaw version** (read from installed package.json):
```typescript
path.join(HOME, '.openclaw-android', 'node', 'lib', 'node_modules', 'openclaw', 'package.json')
```

---

## PHASE 2 — NEW TYPE DEFINITIONS

Add to `src/gateway/types.ts`:

```typescript
// ---- tani_current_actions ----
export interface ActiveProcess {
    pid: string;
    command: string;
    cpu: string;
    mem: string;
}

export interface RecentToolCall {
    sessionKey: string;
    agentId: string;
    toolName: string;
    toolInput?: string; // truncated to 200 chars
    timestamp: string | null;
}

export interface CurrentActionsResponse {
    is_idle: boolean;
    idle_reason?: string;
    active_processes: ActiveProcess[];
    recently_active_sessions: Array<{
        sessionKey: string;
        agentId: string;
        sessionId: string;
        lastModifiedSecondsAgo: number;
    }>;
    recent_tool_calls: RecentToolCall[];
    gateway_log_tail: string[];
    checked_at: string;
}

// ---- system_health ----
export interface SystemHealthResponse {
    gateway_reachable: boolean;
    gateway_status: string;
    openclaw_version: string | null;
    memory: {
        total_mb: number;
        available_mb: number;
        used_percent: number;
    };
    load_avg: {
        '1m': number;
        '5m': number;
        '15m': number;
    };
    disk: {
        path: string;
        total: string;
        used: string;
        available: string;
        use_percent: string;
    } | null;
    active_openclaw_processes: ActiveProcess[];
    checked_at: string;
}

// ---- tani_sessions_detail ----
export interface SessionDetail {
    sessionKey: string;
    sessionId: string;
    agentId: string;
    updatedAt: string;
    lastModifiedSecondsAgo: number | null;
    is_recently_active: boolean; // modified in last 90 seconds
    chatType: string;
    compactionCount: number;
    abortedLastRun: boolean;
    is_subagent: boolean;
    last_tool_call: string | null; // tool name only, from last JSONL line that is a tool_use block
    jsonl_line_count: number | null;
}

export interface SessionsDetailResponse {
    agents_checked: string[];
    sessions: SessionDetail[];
    total: number;
}
```

---

## PHASE 3 — BUILD THE FOUR TOOL FILES

### Tool 1: `src/tools/current_actions.ts`

**Purpose:** Answer "is Tani currently doing something?" before sending a message. The single most important tool — this prevents double-triggering.

**Strategy:**
- A session is "recently active" if its JSONL file mtime is < 90 seconds ago
- Run `ps aux` via exec and grep for `node|npm|git|openclaw`
- Read the last 5 lines of each recently-active session's JSONL, parse for tool_use blocks
- Read the last 20 lines of the real gateway log
- `is_idle = true` only if: no recently-active sessions AND no relevant processes found

```typescript
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
                        gatewayLogTail.push(...lines.map(l =>
                            l.replace(/Bearer [A-Za-z0-9_.-]+/ig, 'Bearer [REDACTED]')
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
```

---

### Tool 2: `src/tools/system_health.ts`

**Purpose:** One-call snapshot of device health — RAM, CPU load, disk, openclaw version, gateway reachability, active processes. Sub-second. No reasoning overhead.

**Implementation notes:**
- Read `/proc/meminfo` with `fs.readFile` for MemTotal and MemAvailable
- Read `/proc/loadavg` for 1m/5m/15m load averages
- Run `df -h $HOME` via exec for disk stats
- Re-use `client.getHealth()` for gateway reachability
- Read openclaw version from the installed package.json on disk (no shell)
- Re-use the same ps grep pattern from Tool 1

```typescript
import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { SystemHealthResponse, ActiveProcess } from '../gateway/types.js';

const execAsync = promisify(exec);
const HOME = os.homedir();

export const systemHealthTool = {
    name: 'system_health',
    description: 'Snapshot of Termux device health: RAM, CPU load, disk space, OpenClaw version, gateway reachability, and active OpenClaw/node processes. Fast and read-only — safe to call any time.',
    inputSchema: { type: 'object', properties: {}, required: [] }
};

export async function handleSystemHealth(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const result: SystemHealthResponse = {
        gateway_reachable: false,
        gateway_status: 'unknown',
        openclaw_version: null,
        memory: { total_mb: 0, available_mb: 0, used_percent: 0 },
        load_avg: { '1m': 0, '5m': 0, '15m': 0 },
        disk: null,
        active_openclaw_processes: [],
        checked_at: new Date().toISOString()
    };

    // Gateway health
    try {
        const health = await client.getHealth();
        result.gateway_reachable = health.status === 'ok';
        result.gateway_status = health.message;
    } catch {
        result.gateway_status = 'unreachable';
    }

    // OpenClaw version
    try {
        const versionPath = path.join(
            HOME, '.openclaw-android', 'node', 'lib',
            'node_modules', 'openclaw', 'package.json'
        );
        const pkg = JSON.parse(await fs.readFile(versionPath, 'utf-8'));
        result.openclaw_version = pkg.version || null;
    } catch {
        // version file not found
    }

    // Memory — parse /proc/meminfo
    try {
        const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
        const parse = (key: string): number => {
            const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
            return match ? Math.round(parseInt(match[1]) / 1024) : 0;
        };
        const total = parse('MemTotal');
        const available = parse('MemAvailable');
        result.memory = {
            total_mb: total,
            available_mb: available,
            used_percent: total > 0 ? Math.round(((total - available) / total) * 100) : 0
        };
    } catch {
        // /proc/meminfo unavailable
    }

    // Load average — parse /proc/loadavg
    try {
        const loadavg = await fs.readFile('/proc/loadavg', 'utf-8');
        const parts = loadavg.trim().split(/\s+/);
        result.load_avg = {
            '1m': parseFloat(parts[0]) || 0,
            '5m': parseFloat(parts[1]) || 0,
            '15m': parseFloat(parts[2]) || 0
        };
    } catch {
        // /proc/loadavg unavailable
    }

    // Disk — df -h on home dir
    try {
        const { stdout } = await execAsync(`df -h "${HOME}"`, { timeout: 5000 });
        const lines = stdout.trim().split('\n');
        if (lines.length >= 2) {
            const parts = lines[1].trim().split(/\s+/);
            if (parts.length >= 6) {
                result.disk = {
                    path: parts[5],
                    total: parts[1],
                    used: parts[2],
                    available: parts[3],
                    use_percent: parts[4]
                };
            }
        }
    } catch {
        // df failed
    }

    // Active OpenClaw-related processes
    try {
        const { stdout } = await execAsync(
            "ps aux | grep -E '(node|npm|openclaw)' | grep -v grep | awk '{print $1,$2,$3,$4,substr($0,index($0,$11))}'",
            { timeout: 5000 }
        );
        for (const line of stdout.trim().split('\n').filter(Boolean)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
                result.active_openclaw_processes.push({
                    pid: parts[1],
                    command: parts.slice(4).join(' ').slice(0, 120),
                    cpu: parts[2],
                    mem: parts[3]
                });
            }
        }
    } catch {
        // ps failed
    }

    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
}
```

---

### Tool 3: `src/tools/sessions_detail.ts`

**Purpose:** Enriched version of `tani_sessions_list` — adds live activity detection (JSONL mtime), subagent detection (session key pattern), last tool call name, and JSONL line count. Answers "what are all my agents doing right now, and who spawned what."

**Subagent session key pattern:** Keys matching `agent:*:subagent:*` are subagent sessions. The correct format is `agent:<agentId>:subagent:<uuid>` — NOT `subagent:<parentId>:d<depth>` (that format is wrong and was hallucinated in a prior analysis).

```typescript
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
        return (b.lastModifiedSecondsAgo ?? Infinity) - (a.lastModifiedSecondsAgo ?? Infinity);
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
```

---

### Tool 4: `src/tools/recent_log.ts`

**Purpose:** The simplest tool — returns the real gateway log tail with zero config options. Pairs with `tani_current_actions` but useful standalone when you just want to see what the gateway just did. Importantly, this fixes the known bug where `openclaw_logs` fell back to `commands.log` (session lifecycle only) — `tani_recent_log` ALWAYS uses the real PID-keyed gateway log.

```typescript
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
                .map(l => l.replace(/Bearer [A-Za-z0-9_.-]+/ig, 'Bearer [REDACTED]'));
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
```

---

## PHASE 4 — WIRE EVERYTHING INTO `src/server.ts`

Add these imports at the top (after existing imports):

```typescript
import { currentActionsTool, handleCurrentActions } from './tools/current_actions.js';
import { systemHealthTool, handleSystemHealth } from './tools/system_health.js';
import { sessionsDetailTool, handleSessionsDetail } from './tools/sessions_detail.js';
import { recentLogTool, handleRecentLog } from './tools/recent_log.js';
```

In the `ListToolsRequestSchema` handler, add the 4 new tools to the `tools` array:
```typescript
currentActionsTool,
systemHealthTool,
sessionsDetailTool,
recentLogTool,
```

In the `CallToolRequestSchema` switch, add 4 new cases:
```typescript
case currentActionsTool.name:
    return handleCurrentActions(client, request.params.arguments || {});

case systemHealthTool.name:
    return handleSystemHealth(client, request.params.arguments || {});

case sessionsDetailTool.name:
    return handleSessionsDetail(client, request.params.arguments || {});

case recentLogTool.name:
    return handleRecentLog(client, request.params.arguments || {});
```

---

## PHASE 5 — BUILD AND VERIFY

```bash
cd ~/openclaw-mcp-termux
npm run build
```

**Expected:** TypeScript compiles with zero errors. If you see `TS2305: Module has no exported member`, you missed an export in `types.ts`. If you see `TS2307: Cannot find module`, check the `.js` extension on all imports (ESM requires explicit `.js` extensions even for `.ts` source files).

**Verify the 4 tools appear:**
```bash
# List all exported tool names from server.ts
grep "Tool.name" dist/server.js
```

**Smoke test without a running gateway:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```
Should return a tools list including all 4 new tool names.

---

## CONSTRAINTS AND ANTI-PATTERNS

- **Never use `axios` or any HTTP client** for file reads — use `node:fs/promises` directly.
- **Never use `require()`** — this is ESM (`"type": "module"` in package.json). All imports must use `import`.
- **Always use `.js` extensions** on local imports, even though files are `.ts`. TypeScript ESM requires this.
- **Never add new dependencies** to package.json. Everything must use Node.js built-ins or the existing `@modelcontextprotocol/sdk`.
- **Never throw from handler functions** — catch all errors and return `{ isError: true, content: [...] }`.
- **The `client` parameter is not used** by tools that read from the filesystem directly. Pass it anyway — the handler signature must match `(client: OpenClawGatewayClient, input: any)`.
- **Never hardcode paths** with `/data/data/com.termux/...` in new files — always derive from `os.homedir()`. The `client.ts` has hardcoded Termux paths for legacy reasons; don't replicate that pattern.
- **Token redaction is required** on any log output: replace `Bearer [token]` and `nvapi-*` patterns.

---

## DONE WHEN

- [ ] `npm run build` passes with zero TypeScript errors
- [ ] `tools/list` returns 11 tools total (7 existing + 4 new)
- [ ] `tani_current_actions` returns `{ is_idle: true/false, ... }` structure
- [ ] `system_health` returns memory/load/disk/version fields
- [ ] `tani_sessions_detail` returns enriched session list with `is_recently_active` and `is_subagent` fields
- [ ] `tani_recent_log` returns from the PID-keyed log path, not `commands.log`
