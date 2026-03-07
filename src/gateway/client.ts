import { CommandResponse, HealthResponse, OpenAIChatCompletionResponse, SessionsResponse } from './types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class OpenClawGatewayClient {
    readonly baseUrl: string;
    readonly token: string;
    readonly timeoutMs: number;

    constructor(baseUrl: string, token: string, timeoutMs: number) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.token = token;
        this.timeoutMs = timeoutMs;
    }

    private buildHeaders(extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        return { ...headers, ...extra };
    }

    private createError(code: string, message: string, hint?: string) {
        const error: any = new Error(message);
        error.code = code;
        error.hint = hint;
        return error;
    }

    /**
     * Health check: send a minimal chat completion request.
     * A 400 means the gateway is alive (parsed JSON, rejected input).
     * A 200 means healthy. Connection errors mean gateway is down.
     */
    async getHealth(): Promise<HealthResponse> {
        const url = `${this.baseUrl}/v1/chat/completions`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: this.buildHeaders(),
                body: JSON.stringify({
                    model: 'health-check',
                    messages: [],
                    max_tokens: 1,
                }),
            });

            // Both 2xx and 4xx mean the gateway is alive and processing
            if (response.status >= 200 && response.status < 500) {
                return { status: 'ok', message: `Gateway responding (HTTP ${response.status})` };
            }

            return { status: 'error', message: `Gateway error (HTTP ${response.status})` };
        } catch (err: any) {
            if (err.name === 'AbortError') {
                throw this.createError('GATEWAY_TIMEOUT', `Gateway request timed out after ${this.timeoutMs}ms`);
            }
            throw this.createError('GATEWAY_UNREACHABLE', `Could not connect to OpenClaw gateway at ${this.baseUrl}`, 'Ensure OpenClaw is running: openclaw start');
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Send a message via the OpenAI-compatible /v1/chat/completions endpoint.
     */
    async sendCommand(agentId: string, message: string, sessionId?: string): Promise<CommandResponse> {
        const url = `${this.baseUrl}/v1/chat/completions`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const body: Record<string, unknown> = {
            model: 'default',
            messages: [{ role: 'user', content: message }],
            max_tokens: 4096,
        };

        if (sessionId) {
            body.session_id = sessionId;
        }

        const extraHeaders: Record<string, string> = {};
        if (sessionId) {
            extraHeaders['x-openclaw-session-key'] = sessionId;
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: this.buildHeaders(extraHeaders),
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}`;
                try { errorMsg = await response.text(); } catch { }

                if (response.status === 401 || response.status === 403) {
                    throw this.createError('GATEWAY_AUTH_FAILED', `Authentication failed (${response.status})`, 'Check your OPENCLAW_GATEWAY_TOKEN against ~/.openclaw/secrets.json');
                }
                throw this.createError('GATEWAY_ERROR', `Gateway returned error: ${errorMsg}`);
            }

            const completion = (await response.json()) as OpenAIChatCompletionResponse;
            const content = completion.choices?.[0]?.message?.content ?? '';

            return {
                response: content,
                model: completion.model,
                usage: completion.usage,
            };
        } catch (err: any) {
            if (err.code) throw err; // Already structured
            if (err.name === 'AbortError') {
                throw this.createError('GATEWAY_TIMEOUT', `Gateway request timed out after ${this.timeoutMs}ms`, 'Tani may be processing. Increase OPENCLAW_TIMEOUT_MS.');
            }
            if (err.message?.includes('fetch failed') || err.code === 'ECONNREFUSED') {
                throw this.createError('GATEWAY_UNREACHABLE', `Could not connect to OpenClaw gateway at ${this.baseUrl}`, 'Ensure OpenClaw is running: openclaw start');
            }
            throw this.createError('TOOL_ERROR', err.message || String(err));
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * List sessions by reading the sessions.json file from disk.
     * This matches how the working MCP operates — filesystem access, not HTTP.
     */
    async listSessions(agentId: string = 'main'): Promise<SessionsResponse> {
        const home = process.env.HOME || '/data/data/com.termux/files/home';
        const sessionsPath = path.join(home, '.openclaw', 'agents', agentId, 'sessions', 'sessions.json');

        try {
            const raw = await fs.readFile(sessionsPath, 'utf-8');
            const data = JSON.parse(raw);

            // Parse into a structured list
            const sessions = Object.entries(data).map(([id, entry]: [string, any]) => ({
                id,
                model: entry.model || 'unknown',
                updated: entry.updatedAt || entry.updated || 'unknown',
                flags: entry.flags || 'none',
            }));

            return { sessions };
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return { sessions: [] };
            }
            throw this.createError('TOOL_ERROR', `Failed to read sessions: ${err.message}`);
        }
    }
}
