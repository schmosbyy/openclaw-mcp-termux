import { HealthResponse, SessionsResponse, DoctorResponse, RestartResponse } from './types.js';
import { TokenProvider } from './token-provider.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
            // (400 is the EXPECTED response for a malformed health-check request)
            if (response.status >= 200 && response.status < 500) {
                return { status: 'ok', message: 'Healthy' };
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
     * List sessions by reading the sessions.json file from disk.
     * This matches how the working MCP operates — filesystem access, not HTTP.
     */
    async listSessions(agentId: string = 'main'): Promise<SessionsResponse> {
        const home = process.env.HOME || '/data/data/com.termux/files/home';
        const sessionsPath = path.join(home, '.openclaw', 'agents', agentId, 'sessions', 'sessions.json');

        try {
            const raw = await fs.readFile(sessionsPath, 'utf-8');
            const data = JSON.parse(raw);

            // Map real sessions.json shape: keyed by sessionKey string
            // Each entry: { sessionId, updatedAt (epoch ms), chatType, compactionCount, abortedLastRun, sessionFile }
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
                // Default to the gateway wrapper script.
                // Can be overridden via OPENCLAW_BIN_PATH env var.
                openclawBin = '/data/data/com.termux/files/home/bin/openclaw-proot.sh';
            }

            // Ensure both Termux bin and the OpenClaw node bin are in PATH.
            // This is critical: the openclaw script uses `#!/usr/bin/env node`, so `env` must
            // be able to resolve `node` — which lives in the openclaw-android node bin directory.
            const env = { ...process.env };
            const termuxBin = '/data/data/com.termux/files/usr/bin';
            const pathsToAdd = [termuxBin].filter(p => !env.PATH?.includes(p));
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
     * Valid flags: --fix, --non-interactive only.
     * --json and --deep do NOT exist in the openclaw CLI and will cause an error.
     */
    async runDoctor(fix: boolean, nonInteractive: boolean): Promise<DoctorResponse> {
        const args = ['doctor'];
        if (fix) args.push('--fix');
        if (nonInteractive) args.push('--non-interactive');

        const stdout = await this.execOpenClaw(args);

        // Output is plain text — wrap it in a DoctorResponse-compatible shape
        return { status: 'ok', checks: [], message: stdout };
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