import { CommandResponse, HealthResponse, SessionsResponse } from './types.js';

export class OpenClawGatewayClient {
    constructor(
        private baseUrl: string,
        private token: string,
        private timeoutMs: number
    ) { }

    private async request<T>(method: string, path: string, body?: object): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}`;
                try {
                    errorMsg = await response.text();
                } catch { }

                if (response.status === 401 || response.status === 403) {
                    throw this.createError('GATEWAY_AUTH_FAILED', `Authentication failed (${response.status})`, 'Check your OPENCLAW_GATEWAY_TOKEN against ~/.openclaw/secrets.json');
                }

                throw this.createError('GATEWAY_ERROR', `Gateway returned error: ${errorMsg}`);
            }

            return (await response.json()) as T;
        } catch (err: any) {
            if (err.name === 'AbortError') {
                throw this.createError('GATEWAY_TIMEOUT', `Gateway request timed out after ${this.timeoutMs}ms`, 'The Tani orchestrator or one of its agents may be taking too long. You can increase OPENCLAW_TIMEOUT_MS in your bridge config.');
            }
            if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
                throw this.createError('GATEWAY_UNREACHABLE', `Could not connect to OpenClaw gateway at ${this.baseUrl}`, 'Ensure the OpenClaw assistant is running (openclaw start) and listening on the configured loopback port.');
            }

            if (err.code && err.message) {
                throw err; // Already a structured GatewayError
            }

            throw this.createError('TOOL_ERROR', err.message || String(err));
        } finally {
            clearTimeout(timeout);
        }
    }

    private createError(code: string, message: string, hint?: string) {
        const error: any = new Error(message);
        error.code = code;
        error.hint = hint;
        return error;
    }

    async sendCommand(agentId: string, message: string, sessionId?: string): Promise<CommandResponse> {
        return this.request<CommandResponse>('POST', '/command', {
            agentId,
            message,
            ...(sessionId ? { sessionId } : {})
        });
    }

    async getHealth(): Promise<HealthResponse> {
        return this.request<HealthResponse>('GET', '/health');
    }

    async listSessions(agentId?: string): Promise<SessionsResponse> {
        const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
        return this.request<SessionsResponse>('GET', `/sessions${query}`);
    }
}
