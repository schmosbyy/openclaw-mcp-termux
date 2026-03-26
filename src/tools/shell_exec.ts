import { OpenClawGatewayClient } from '../gateway/client.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as fs from 'node:fs';

const execAsync = promisify(exec);

export const shellExecTool = {
    name: 'shell_exec',
    description: 'Execute arbitrary shell commands on the Termux device. Useful for direct filesystem inspection and diagnostics. Only call when the user has explicitly requested execution, or when diagnostics are clearly required for the task at hand. Do not use for speculative exploration or as a default first step.',
    inputSchema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The shell command to run.'
            },
            timeout: {
                type: 'number',
                description: 'Timeout in milliseconds (max 30000ms). Default is 10000ms.'
            },
            cwd: {
                type: 'string',
                description: 'Working directory for the command. Default is the home directory.'
            }
        },
        required: ['command']
    }
};

export async function handleShellExec(client: OpenClawGatewayClient, input: any) {
    const rawCommand = String(input.command || '');
    if (!rawCommand.trim()) {
        return { isError: true, content: [{ type: 'text', text: 'Command cannot be empty' }] };
    }

    // Safety checks (blocklist)
    const blockedPatterns = [
        'rm -rf /',
        'mkfs',
        'dd if=',
        ':(){:|:&};:' // fork bomb
    ];

    for (const pattern of blockedPatterns) {
        if (rawCommand.includes(pattern)) {
            return {
                isError: true,
                content: [{ type: 'text', text: `Error: Command contains blocked pattern "${pattern}" and was rejected for safety.` }]
            };
        }
    }

    // Resolve ~ to home directory in command
    const command = rawCommand.replace(/(^|\s)~(\/|\s|$)/g, (match, prefix, suffix) => {
        return prefix + os.homedir() + suffix;
    });

    let timeoutMs = input.timeout !== undefined ? Number(input.timeout) : 10000;
    if (isNaN(timeoutMs) || timeoutMs <= 0) timeoutMs = 10000;
    if (timeoutMs > 30000) timeoutMs = 30000;

    let cwd = input.cwd ? String(input.cwd) : os.homedir();
    cwd = cwd.replace(/^~(?=$|\/|\\)/, os.homedir());

    // Setup environment
    const env = { ...process.env };
    const termuxBin = '/data/data/com.termux/files/usr/bin';
    const pathsToAdd = [termuxBin].filter(p => !env.PATH?.includes(p));
    if (pathsToAdd.length > 0) {
        env.PATH = env.PATH ? `${pathsToAdd.join(':')}:${env.PATH}` : pathsToAdd.join(':');
    }

    const glibcPatch = '/data/data/com.termux/files/home/.openclaw-android/patches/glibc-compat.js';
    if (!env.NODE_OPTIONS?.includes('glibc-compat')) {
        if (fs.existsSync(glibcPatch)) {
            env.NODE_OPTIONS = `--no-warnings=DEP0040 -r ${glibcPatch}`;
        } else {
            env.NODE_OPTIONS = `--no-warnings=DEP0040`;
        }
    }

    let finalOutput = '';
    let isError = false;

    try {
        const { stdout, stderr } = await execAsync(command, {
            env,
            cwd,
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024 // 10MB to prevent child process crashing on large output
        });

        finalOutput = stdout;
        if (stderr && stderr.trim().length > 0) {
            finalOutput += `\n--- stderr ---\n${stderr}`;
        }
    } catch (err: any) {
        isError = true;
        let prefix = '';
        if (err.code !== undefined && typeof err.code === 'number') {
            prefix += `[exit code: ${err.code}]\n`;
        } else if (err.code) { // String codes like ENOENT
            prefix += `[error code: ${err.code}]\n`;
        } else {
            prefix += `[exit code: non-zero]\n`;
        }

        let errOut = '';
        if (err.stdout) {
            errOut += err.stdout;
        }
        if (err.stderr && err.stderr.trim().length > 0) {
            if (errOut.length > 0 && !errOut.endsWith('\n')) errOut += '\n';
            errOut += `--- stderr ---\n${err.stderr}`;
        }

        if (err.killed && err.signal === 'SIGTERM') {
            errOut += `\n[process killed via timeout after ${timeoutMs}ms]`;
        } else if (!err.stdout && !err.stderr) {
            errOut += err.message;
        }

        finalOutput = prefix + errOut;
    }

    // Cap output at 50KB total length
    const MAX_CHARS = 50 * 1024;
    if (finalOutput.length > MAX_CHARS) {
        finalOutput = finalOutput.substring(0, MAX_CHARS) + '\n[output truncated at 50KB]';
    }

    return {
        isError,
        content: [{ type: 'text', text: finalOutput.trim() || '[no output]' }]
    };
}
