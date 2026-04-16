// ─── Gateway Responses ──────────────────────────────────────────────

export interface HealthResponse {
    status: 'ok' | 'error';
    message: string;
}

export interface SessionsResponse {
    sessions: SessionEntry[];
}

export interface SessionEntry {
    sessionKey: string;
    sessionId: string;
    updatedAt: string;
    chatType: string;
    compactionCount: number;
    abortedLastRun: boolean;
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

// ─── Gateway API Responses ──────────────────────────────────────────

export interface InvokeToolResponse {
    ok: boolean;
    result?: any;
    error?: string;
}

export interface SpawnSessionResponse {
    ok: boolean;
    status?: string;
    runId?: string;
    childSessionKey?: string;
    error?: string;
}

// ─── System / Process Types ─────────────────────────────────────────

export interface ActiveProcess {
    pid: string;
    command: string;
    cpu: string;
    mem: string;
}

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
