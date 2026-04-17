import { HealthResponse, SessionsResponse, DoctorResponse, InvokeToolResponse, SpawnSessionResponse } from './types.js';
import { TokenProvider } from './token-provider.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class OpenClawGatewayClient {
    readonly baseUrl: string;
    private tokenProvider: TokenProvider;
    readonly timeoutMs: number;

    constructor(baseUrl: string, tokenProvider: TokenProvider, timeoutMs: number) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.tokenProvider = tokenProvider;
        this.timeoutMs = timeoutMs;
    }

    private buildHeaders(extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        const token = this.tokenProvider.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
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
     * Execute an OpenClaw CLI command via SSH to proot (~200ms tunnel + CLI time).
     * This replaces the old wrapper script approach which had 2-10s cold start.
     * SSH exit code 255 on interactive commands is normal — ignore code, trust stdout.
     */
    private async execViaSSH(args: string[]): Promise<string> {
        const command = `ssh proot "openclaw ${args.join(' ')}"`;
        try {
            const { stdout, stderr } = await execAsync(command, {
                timeout: 60000,
                maxBuffer: 10 * 1024 * 1024
            });
            return (stdout || '').trim();
        } catch (err: any) {
            // SSH returns exit 255 for interactive/TUI commands — output is still valid
            if (err.stdout) {
                return err.stdout.trim();
            }
            throw this.createError('TOOL_ERROR', `SSH command failed: ${err.message}`);
        }
    }

    // ─── Health ────────────────────────────────────────────────────────

    /**
     * Health check via GET /health through SSH tunnel to proot.
     * The gateway listens on localhost:18789 inside proot — not accessible
     * from Termux's network namespace. Must route through ssh proot.
     */
    async getHealth(): Promise<HealthResponse> {
        try {
            const { stdout } = await execAsync(
                `ssh proot "curl -sS -m 5 http://localhost:18789/health"`,
                { timeout: 10000 }
            );
            const text = (stdout || '').trim();
            if (text) {
                return { status: 'ok', message: text };
            }
            return { status: 'error', message: 'Empty response from /health' };
        } catch (err: any) {
            if (err.stdout) {
                return { status: 'ok', message: err.stdout.trim() || 'Healthy' };
            }
            throw this.createError('GATEWAY_UNREACHABLE', `Could not reach OpenClaw gateway via ssh proot: ${err.message}`, 'Ensure OpenClaw is running: openclaw start');
        }
    }

    // ─── Sessions (filesystem) ─────────────────────────────────────────

    /**
     * List sessions by reading sessions.json from disk (~16ms).
     */
    async listSessions(agentId: string = 'main'): Promise<SessionsResponse> {
        const home = process.env.HOME || '/data/data/com.termux/files/home';
        const sessionsPath = path.join(home, '.openclaw', 'agents', agentId, 'sessions', 'sessions.json');

        try {
            const raw = await fs.readFile(sessionsPath, 'utf-8');
            const data = JSON.parse(raw);

            const sessions = Object.entries(data).map(([sessionKey, entry]: [string, any]) => ({
                sessionKey,
                sessionId: entry.sessionId || 'unknown',
                updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : 'unknown',
                chatType: entry.chatType || 'unknown',
                compactionCount: entry.compactionCount ?? 0,
                abortedLastRun: entry.abortedLastRun ?? false,
            }));

            return { sessions };
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return { sessions: [] };
            }
            throw this.createError('TOOL_ERROR', `Failed to read sessions: ${err.message}`);
        }
    }

    // ─── Gateway HTTP API ──────────────────────────────────────────────

    /**
     * Invoke a gateway tool directly via POST /tools/invoke.
     * Useful for session management, tool execution without a full agent turn.
     */
    async invokeTool(toolName: string, args: Record<string, any> = {}): Promise<InvokeToolResponse> {
        const url = `${this.baseUrl}/tools/invoke`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: this.buildHeaders(),
                body: JSON.stringify({ tool: toolName, arguments: args }),
            });

            if (response.status === 401) {
                const retried = await this.refreshOn401(response);
                if (retried) return this.invokeTool(toolName, args);
            }

            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}`;
                try { errorMsg = await response.text(); } catch { }
                return { ok: false, error: errorMsg };
            }

            const data = await response.json();
            return { ok: true, result: data.result ?? data.tool_output ?? data };
        } catch (err: any) {
            return { ok: false, error: err.message };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Spawn a sub-agent session via POST /sessions_spawn.
     * Non-blocking — returns immediately with runId + childSessionKey.
     * This is the proper parent→child delegation mechanism for the God Orchestrator pattern.
     */
    async spawnSession(task: string, opts: {
        runtime?: string;
        agentId?: string;
        model?: string;
        thinking?: string;
        runTimeoutSeconds?: number;
        mode?: string;
        cleanup?: string;
    } = {}): Promise<SpawnSessionResponse> {
        const url = `${this.baseUrl}/sessions_spawn`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const payload: Record<string, any> = { task };
        if (opts.runtime) payload.runtime = opts.runtime;
        if (opts.agentId) payload.agentId = opts.agentId;
        if (opts.model) payload.model = opts.model;
        if (opts.thinking) payload.thinking = opts.thinking;
        if (opts.runTimeoutSeconds) payload.runTimeoutSeconds = opts.runTimeoutSeconds;
        if (opts.mode) payload.mode = opts.mode;
        if (opts.cleanup) payload.cleanup = opts.cleanup;

        try {
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: this.buildHeaders(),
                body: JSON.stringify(payload),
            });

            if (response.status === 401) {
                const retried = await this.refreshOn401(response);
                if (retried) return this.spawnSession(task, opts);
            }

            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}`;
                try { errorMsg = await response.text(); } catch { }
                return { ok: false, error: errorMsg };
            }

            const data = await response.json();
            return {
                ok: true,
                status: data.status,
                runId: data.runId,
                childSessionKey: data.childSessionKey,
            };
        } catch (err: any) {
            return { ok: false, error: err.message };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Send a message to an agent via POST /hooks/agent (fire-and-forget).
     * Uses hook secret auth (x-openclaw-token), not gateway bearer token.
     */
    async sendToAgent(payload: Record<string, any>): Promise<{ ok: boolean; status?: string; error?: string }> {
        const secret = process.env.OPENCLAW_HOOK_SECRET;
        if (!secret) {
            return { ok: false, error: 'OPENCLAW_HOOK_SECRET is not configured' };
        }

        const url = `${this.baseUrl}/hooks/agent`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'x-openclaw-token': secret,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}`;
                try { errorMsg = await response.text(); } catch { }
                return { ok: false, error: errorMsg };
            }

            return { ok: true, status: 'accepted' };
        } catch (err: any) {
            let code = err.code || 'UNKNOWN_ERROR';
            if (err.name === 'AbortError') code = 'TIMEOUT_ERROR';
            return { ok: false, error: `${code}: ${err.message}` };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Send a message and get a synchronous reply via POST /v1/chat/completions.
     * Auth through TokenProvider — gets automatic token refresh on 401.
     */
    async chatCompletions(agentId: string, messages: Array<{ role: string; content: string }>, opts: {
        maxTokens?: number;
        timeoutMs?: number;
    } = {}): Promise<{
        ok: boolean;
        reply?: string;
        finishReason?: string;
        error?: string;
    }> {
        const url = `${this.baseUrl}/v1/chat/completions`;
        const timeoutMs = opts.timeoutMs || 300000;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const payload = {
            model: `openclaw/${agentId}`,
            messages,
            max_tokens: opts.maxTokens || 1000,
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: this.buildHeaders(),
                body: JSON.stringify(payload),
            });

            if (response.status === 401) {
                const retried = await this.refreshOn401(response);
                if (retried) return this.chatCompletions(agentId, messages, opts);
            }

            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}`;
                try { errorMsg = await response.text(); } catch { }
                return { ok: false, error: errorMsg };
            }

            const data = await response.json() as any;
            let content = '';
            let finishReason = '';
            if (data.choices && data.choices.length > 0) {
                content = data.choices[0].message?.content || '';
                finishReason = data.choices[0].finish_reason || '';
            }

            return { ok: true, reply: content, finishReason };
        } catch (err: any) {
            let code = err.code || 'UNKNOWN_ERROR';
            if (err.name === 'AbortError') code = 'TIMEOUT_ERROR';
            return { ok: false, error: `${code}: ${err.message}` };
        } finally {
            clearTimeout(timeout);
        }
    }

    // ─── Token Refresh ─────────────────────────────────────────────────

    /**
     * On 401, attempt to refresh the token from paired.json and return true
     * so the caller can retry. Returns false if refresh fails or token unchanged.
     */
    private async refreshOn401(response: Response): Promise<boolean> {
        if (response.status !== 401) return false;
        const fresh = await this.tokenProvider.refresh();
        return fresh !== null;
    }

    // ─── CLI via SSH ───────────────────────────────────────────────────

    /**
     * Run OpenClaw doctor via SSH.
     */
    async runDoctor(fix: boolean, nonInteractive: boolean): Promise<DoctorResponse> {
        const args = ['doctor'];
        if (fix) args.push('--fix');
        if (nonInteractive) args.push('--non-interactive');

        const stdout = await this.execViaSSH(args);
        return { status: 'ok', checks: [], message: stdout };
    }

    /**
     * Get OpenClaw version via SSH.
     */
    async getVersion(): Promise<string | null> {
        try {
            const stdout = await this.execViaSSH(['--version']);
            return stdout || null;
        } catch {
            return null;
        }
    }
}
