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
