import { CommandResponse, HealthResponse, OpenAIChatCompletionResponse, SessionsResponse, DoctorResponse, LogsResponse, RestartResponse } from './types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

    /**
     * Execute a local shell command securely as OpenClaw CLI
     */
    private async execOpenClaw(args: string[]): Promise<string> {
        try {
            // First, allow the user to explicitly define where the openclaw binary is via the environment
            // This is the most reliable way when running via a non-interactive SSH shell.
            let openclawBin = process.env.OPENCLAW_BIN_PATH;

            // If they didn't provide it, let's try to guess the most likely location in Termux
            if (!openclawBin) {
                openclawBin = '/data/data/com.termux/files/home/.openclaw-android/node/bin/openclaw';
            }

            // Ensure both Termux bin and the OpenClaw node bin are in PATH.
            // This is critical: the openclaw script uses `#!/usr/bin/env node`, so `env` must
            // be able to resolve `node` — which lives in the openclaw-android node bin directory.
            const env = { ...process.env };
            const termuxBin = '/data/data/com.termux/files/usr/bin';
            const openclawNodeBin = '/data/data/com.termux/files/home/.openclaw-android/node/bin';
            const pathsToAdd = [openclawNodeBin, termuxBin].filter(p => !env.PATH?.includes(p));
            if (pathsToAdd.length > 0) {
                env.PATH = env.PATH ? `${pathsToAdd.join(':')}:${env.PATH}` : pathsToAdd.join(':');
            }

            const { stdout, stderr } = await execFileAsync(openclawBin, args, {
                env,
                timeout: 60000, // 60s max
                maxBuffer: 10 * 1024 * 1024 // 10MB max buffer for logs
            });
            return stdout.trim();
        } catch (err: any) {
            if (err.stdout) {
                // The CLI returned non-zero, but might have printed valid JSON
                return err.stdout.trim();
            }
            throw this.createError('TOOL_ERROR', `Command execution failed: ${err.message}`);
        }
    }

    /**
     * Run OpenClaw doctor
     */
    async runDoctor(fix: boolean, nonInteractive: boolean, deep: boolean, json: boolean): Promise<DoctorResponse> {
        const args = ['doctor'];
        if (fix) args.push('--fix');
        if (nonInteractive) args.push('--non-interactive');
        if (deep) args.push('--deep');
        if (json) args.push('--json');

        const stdout = await this.execOpenClaw(args);

        if (json) {
            try {
                return JSON.parse(stdout) as DoctorResponse;
            } catch (err) {
                throw this.createError('TOOL_ERROR', `Failed to parse doctor output as JSON: ${stdout.substring(0, 100)}...`);
            }
        }

        // Unlikely to hit this since json=true is default/required for programmatic access
        return { status: 'warn', checks: [], message: stdout } as any;
    }

    /**
     * Get OpenClaw logs
     */
    async getLogs(limit: number, json: boolean, level?: string): Promise<LogsResponse> {
        const args = ['logs'];
        if (limit) {
            args.push('--limit', limit.toString());
        }
        if (json) args.push('--json');

        const stdout = await this.execOpenClaw(args);

        if (json) {
            try {
                // If it's a single JSON object with a .lines property (expected shape):
                let parsed: any;
                try {
                    parsed = JSON.parse(stdout);
                } catch (e) {
                    // It might be line-delimited JSON. Let's parse it manually if needed.
                    const lines = stdout.split('\n').filter(Boolean).map(l => JSON.parse(l));
                    parsed = { lines, total: lines.length, truncated: false };
                }

                if (level) {
                    parsed.lines = parsed.lines.filter((l: any) => l.level === level);
                }

                return parsed as LogsResponse;
            } catch (err) {
                throw this.createError('TOOL_ERROR', `Failed to parse logs output as JSON: ${stdout.substring(0, 100)}...`);
            }
        }

        return { lines: [], total: 0, truncated: false };
    }

    /**
     * Restart OpenClaw gateway
     */
    async restartGateway(json: boolean): Promise<RestartResponse> {
        const args = ['gateway', 'restart'];
        if (json) args.push('--json');

        const stdout = await this.execOpenClaw(args);

        if (json) {
            try {
                return JSON.parse(stdout) as RestartResponse;
            } catch (err) {
                throw this.createError('TOOL_ERROR', `Failed to parse restart output as JSON: ${stdout.substring(0, 100)}...`);
            }
        }

        return { status: 'restarted', message: 'Assuming success due to non-JSON format' };
    }
}