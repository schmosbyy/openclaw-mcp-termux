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
    id: string;
    model: string;
    updated: string;
    flags: string;
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
}

export interface LogLine {
    timestamp: string;
    level: string;
    message: string;
    context?: Record<string, any>;
}

export interface LogsResponse {
    lines: LogLine[];
    total: number;
    truncated: boolean;
}

export interface RestartResponse {
    status: 'restarted' | 'failed';
    message: string;
    pid?: number;
}
