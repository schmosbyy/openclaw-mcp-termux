export interface GatewayError {
    code: string;
    message: string;
    hint?: string;
}

export interface CommandResponse {
    message?: string;
    error?: string;
    latency_ms?: number;
    session_id?: string;
    model?: string;
}

export interface SessionsResponse {
    sessions: Array<{
        id: string;
        model: string;
        last_active: string;
        flags?: string[];
    }>;
}

export interface HealthResponse {
    status: string;
    uptime_seconds: number;
    agents: Record<string, {
        model: string;
        status: string;
    }>;
}
