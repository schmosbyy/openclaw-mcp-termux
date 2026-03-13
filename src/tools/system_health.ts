import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { SystemHealthResponse, ActiveProcess } from '../gateway/types.js';

const execAsync = promisify(exec);
const HOME = os.homedir();

export const systemHealthTool = {
    name: 'system_health',
    description: 'Snapshot of Termux device health: RAM, CPU load, disk space, OpenClaw version, gateway reachability, and active OpenClaw/node processes. Fast and read-only — safe to call any time.',
    inputSchema: { type: 'object', properties: {}, required: [] }
};

export async function handleSystemHealth(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const result: SystemHealthResponse = {
        gateway_reachable: false,
        gateway_status: 'unknown',
        openclaw_version: null,
        memory: { total_mb: 0, available_mb: 0, used_percent: 0 },
        load_avg: { '1m': 0, '5m': 0, '15m': 0 },
        disk: null,
        active_openclaw_processes: [],
        checked_at: new Date().toISOString()
    };

    // Gateway health
    try {
        const health = await client.getHealth();
        result.gateway_reachable = health.status === 'ok';
        result.gateway_status = health.message;
    } catch {
        result.gateway_status = 'unreachable';
    }

    // OpenClaw version
    try {
        const versionPath = path.join(
            HOME, '.openclaw-android', 'node', 'lib',
            'node_modules', 'openclaw', 'package.json'
        );
        const pkg = JSON.parse(await fs.readFile(versionPath, 'utf-8'));
        result.openclaw_version = pkg.version || null;
    } catch {
        // version file not found
    }

    // Memory — parse /proc/meminfo
    try {
        const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
        const parse = (key: string): number => {
            const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
            return match ? Math.round(parseInt(match[1]) / 1024) : 0;
        };
        const total = parse('MemTotal');
        const available = parse('MemAvailable');
        result.memory = {
            total_mb: total,
            available_mb: available,
            used_percent: total > 0 ? Math.round(((total - available) / total) * 100) : 0
        };
    } catch {
        // /proc/meminfo unavailable
    }

    // Load average — parse /proc/loadavg
    try {
        const loadavg = await fs.readFile('/proc/loadavg', 'utf-8');
        const parts = loadavg.trim().split(/\s+/);
        result.load_avg = {
            '1m': parseFloat(parts[0]) || 0,
            '5m': parseFloat(parts[1]) || 0,
            '15m': parseFloat(parts[2]) || 0
        };
    } catch {
        // /proc/loadavg unavailable
    }

    // Disk — df -h on home dir
    try {
        const { stdout } = await execAsync(`df -h "${HOME}"`, { timeout: 5000 });
        const lines = stdout.trim().split('\n');
        if (lines.length >= 2) {
            const parts = lines[1].trim().split(/\s+/);
            if (parts.length >= 6) {
                result.disk = {
                    path: parts[5],
                    total: parts[1],
                    used: parts[2],
                    available: parts[3],
                    use_percent: parts[4]
                };
            }
        }
    } catch {
        // df failed
    }

    // Active OpenClaw-related processes
    try {
        const { stdout } = await execAsync(
            "ps aux | grep -E '(node|npm|openclaw)' | grep -v grep | awk '{print $1,$2,$3,$4,substr($0,index($0,$11))}'",
            { timeout: 5000 }
        );
        for (const line of stdout.trim().split('\n').filter(Boolean)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
                result.active_openclaw_processes.push({
                    pid: parts[1],
                    command: parts.slice(4).join(' ').slice(0, 120),
                    cpu: parts[2],
                    mem: parts[3]
                });
            }
        }
    } catch {
        // ps failed
    }

    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
}
