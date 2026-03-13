export interface GatewayError {
    code: string;
    message: string;
    hint?: string;
}

export interface OpenAIChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface CommandResponse {
    response: string;
    model: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface HealthResponse {
    status: 'ok' | 'error';
    message: string;
}

export interface SessionEntry {
    sessionKey: string;
    sessionId: string;
    updatedAt: string;
    chatType: string;
    compactionCount: number;
    abortedLastRun: boolean;
}

export interface SessionsResponse {
    sessions: SessionEntry[];
}

export interface DoctorCheck {
    name: string;
    status: 'ok' | 'warn' | 'fail';
    message: string;
    fix_applied?: boolean;
}

export interface DoctorResponse {
    status: 'ok' | 'warn' | 'fail';
    checks: DoctorCheck[];
    repairs_applied?: string[];
    config_backup_path?: string | null;
    message?: string;
}

export interface RestartResponse {
    status: 'restarted' | 'failed';
    message: string;
    pid?: number;
}

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
