import { OpenClawGatewayClient } from '../gateway/client.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as fs from 'node:fs';

const execAsync = promisify(exec);

export const openclawConfigTool = {
    name: 'openclaw_config',
    description: 'Read or write OpenClaw configuration values using `openclaw config get` or `openclaw config set`. Handles the Termux binary path and environment automatically — no shell needed. Use dot-paths like "agents.list[0].model" to target specific keys.',
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['get', 'set'],
                description: '"get" to read a config value, "set" to write one.'
            },
            key: {
                type: 'string',
                description: 'JSON5 dot-path to the config key. Examples: "agents.list[0].model", "agents.defaults.heartbeat", "agents.list[1].memorySearch.query.hybrid"'
            },
            value: {
                type: 'string',
                description: 'Required when action is "set". Must be valid JSON or JSON5. Examples: \'"nvidia-luffy/qwen3.5-397b-a17b"\', \'{ every: "1h" }\', \'true\''
            }
        },
        required: ['action', 'key']
    }
};

const BINARY = '/data/data/com.termux/files/home/bin/openclaw-proot.sh';
const TERMUX_BIN = '/data/data/com.termux/files/usr/bin';
const GLIBC_PATCH = '/data/data/com.termux/files/home/.openclaw-android/patches/glibc-compat.js';
const TIMEOUT_MS = 15000;

export async function handleOpenclawConfig(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const action = String(input.action || '').trim();
    const key    = String(input.key    || '').trim();

    if (action !== 'get' && action !== 'set') {
        return { isError: true, content: [{ type: 'text', text: 'action must be "get" or "set"' }] };
    }
    if (!key) {
        return { isError: true, content: [{ type: 'text', text: 'key is required' }] };
    }
    if (action === 'set' && (input.value === undefined || input.value === null)) {
        return { isError: true, content: [{ type: 'text', text: 'value is required when action is "set"' }] };
    }

    // Expand tilde in binary path (shouldn't be needed but defensive)
    const binary = BINARY.replace(/^~(?=$|\/)/, os.homedir());

    // Build command
    let command: string;
    if (action === 'get') {
        command = `${binary} config get ${key}`;
    } else {
        const value = String(input.value);
        // Shell-quote the key and value with single quotes; escape any embedded single quotes
        const safeKey   = key.replace(/'/g, "'\\''");
        const safeValue = value.replace(/'/g, "'\\''");
        command = `${binary} config set '${safeKey}' '${safeValue}' --json`;
    }

    // Setup environment — same pattern as shell_exec.ts
    const env = { ...process.env };
    const pathsToAdd = [TERMUX_BIN].filter(p => !env.PATH?.includes(p));
    if (pathsToAdd.length > 0) {
        env.PATH = env.PATH ? `${pathsToAdd.join(':')}:${env.PATH}` : pathsToAdd.join(':');
    }

    if (!env.NODE_OPTIONS?.includes('glibc-compat')) {
        if (fs.existsSync(GLIBC_PATCH)) {
            env.NODE_OPTIONS = `--no-warnings=DEP0040 -r ${GLIBC_PATCH}`;
        } else {
            env.NODE_OPTIONS = `--no-warnings=DEP0040`;
        }
    }

    try {
        const { stdout, stderr } = await execAsync(command, {
            env,
            timeout: TIMEOUT_MS
        });

        const output = stdout.trimEnd();

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    ok: true,
                    action,
                    key,
                    value: output
                }, null, 2)
            }]
        };

    } catch (err: any) {
        let message = '';
        if (err.stdout) message += err.stdout;
        if (err.stderr && err.stderr.trim()) {
            if (message && !message.endsWith('\n')) message += '\n';
            message += `--- stderr ---\n${err.stderr}`;
        }
        if (!message) message = err.message || String(err);
        if (err.killed && err.signal === 'SIGTERM') {
            message += `\n[process killed after ${TIMEOUT_MS}ms timeout]`;
        }

        return {
            isError: true,
            content: [{ type: 'text', text: message.trim() }]
        };
    }
}
