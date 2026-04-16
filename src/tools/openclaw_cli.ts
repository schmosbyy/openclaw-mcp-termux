import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import JSON5 from 'json5';

export const openclawCliTool = {
    name: 'openclaw_cli',
    description: 'OpenClaw CLI operations: read/write config, run doctor, check version, restart instructions.\n' +
        '- "config_get": reads openclaw.json directly from filesystem (~16ms, no CLI overhead). Supports dot-paths like "agents.list[0].model".\n' +
        '- "config_set": writes via CLI over SSH (slower but safe — CLI handles validation and env var resolution).\n' +
        '- "doctor": runs openclaw doctor via SSH.\n' +
        '- "version": returns the installed OpenClaw version.\n' +
        '- "restart": returns manual restart instructions (gateway cannot be restarted remotely).',
    inputSchema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                enum: ['config_get', 'config_set', 'doctor', 'version', 'restart'],
                description: 'CLI command to run.'
            },
            key: {
                type: 'string',
                description: '[config_get/config_set] JSON5 dot-path. Examples: "agents.list[0].model", "agents.defaults.heartbeat"'
            },
            value: {
                type: 'string',
                description: '[config_set] Value to set. Must be valid JSON or JSON5. Examples: \'"nvidia-og/model-name"\', \'true\', \'{ every: "1h" }\''
            },
            fix: {
                type: 'boolean',
                description: '[doctor] If true, runs auto-repair. Remind the user before running this.',
                default: false
            },
            non_interactive: {
                type: 'boolean',
                description: '[doctor] Skip confirmation prompts. Default: true.',
                default: true
            }
        },
        required: ['command']
    }
};

// Proot home — where openclaw.json lives
const PROOT_HOME = '/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu/root';
const CONFIG_PATH = path.join(PROOT_HOME, '.openclaw', 'openclaw.json');

export async function handleOpenclawCli(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const command = input.command;

    switch (command) {
        case 'config_get':
            return handleConfigGet(input.key);
        case 'config_set':
            return handleConfigSet(client, input.key, input.value);
        case 'doctor':
            return handleDoctor(client, input.fix, input.non_interactive);
        case 'version':
            return handleVersion(client);
        case 'restart':
            return handleRestart();
        default:
            return { isError: true, content: [{ type: 'text', text: `Unknown command: ${command}` }] };
    }
}

// ─── config_get: FS read + JSON5 parse (~16ms) ──────────────────────────

async function handleConfigGet(key: string | undefined) {
    if (!key) {
        return { isError: true, content: [{ type: 'text', text: 'key is required for config_get' }] };
    }

    try {
        const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
        const config = JSON5.parse(raw);
        const value = resolveDotPath(config, key);

        if (value === undefined) {
            return { isError: true, content: [{ type: 'text', text: `Key not found: ${key}` }] };
        }

        return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, action: 'config_get', key, value }, null, 2) }]
        };
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            return { isError: true, content: [{ type: 'text', text: `Config file not found: ${CONFIG_PATH}` }] };
        }
        return { isError: true, content: [{ type: 'text', text: `Failed to read config: ${err.message}` }] };
    }
}

// ─── config_set: CLI via SSH ────────────────────────────────────────────

async function handleConfigSet(client: OpenClawGatewayClient, key: string | undefined, value: string | undefined) {
    if (!key) {
        return { isError: true, content: [{ type: 'text', text: 'key is required for config_set' }] };
    }
    if (value === undefined || value === null) {
        return { isError: true, content: [{ type: 'text', text: 'value is required for config_set' }] };
    }

    try {
        // Use execViaSSH through the client's runDoctor pattern — but we need raw CLI output
        // So we shell out directly via ssh proot
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);

        const safeKey = key.replace(/'/g, "'\\''");
        const safeValue = String(value).replace(/'/g, "'\\''");
        const cmd = `ssh proot "openclaw config set '${safeKey}' '${safeValue}' --json"`;

        const { stdout } = await execAsync(cmd, { timeout: 60000 });

        return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, action: 'config_set', key, value, output: stdout.trim() }, null, 2) }]
        };
    } catch (err: any) {
        let message = err.message || String(err);
        if (err.stdout) message = err.stdout;
        return { isError: true, content: [{ type: 'text', text: `config_set failed: ${message}` }] };
    }
}

// ─── doctor: CLI via SSH ────────────────────────────────────────────────

async function handleDoctor(client: OpenClawGatewayClient, fix: boolean | undefined, nonInteractive: boolean | undefined) {
    try {
        const response = await client.runDoctor(fix ?? false, nonInteractive ?? true);
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    } catch (err: any) {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({
                ok: false,
                error: { code: err.code || 'UNKNOWN_ERROR', message: err.message, hint: err.hint }
            }, null, 2) }]
        };
    }
}

// ─── version: CLI via SSH ───────────────────────────────────────────────

async function handleVersion(client: OpenClawGatewayClient) {
    const version = await client.getVersion();
    return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, version }, null, 2) }]
    };
}

// ─── restart: manual instructions ───────────────────────────────────────

function handleRestart() {
    return {
        content: [{ type: 'text', text: JSON.stringify({
            ok: false,
            status: 'manual_required',
            message: 'The OpenClaw gateway runs inside a physical Termux terminal session and cannot be restarted remotely.',
            hint: 'Most config changes hot-reload automatically. If restart is needed, do it manually in Termux.'
        }, null, 2) }]
    };
}

// ─── Dot-path resolver ──────────────────────────────────────────────────

function resolveDotPath(obj: any, path: string): any {
    const parts = path.split(/\.|\[(\d+)\]/).filter(Boolean);
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}
