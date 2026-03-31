import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class TokenProvider {
    private cachedToken: string;
    private deviceId: string;        // stable, never rotates
    private pairedJsonPath: string;

    constructor(initialToken: string, deviceId: string) {
        this.cachedToken = initialToken;
        this.deviceId = deviceId;
        const home = process.env.HOME || '/data/data/com.termux/files/home';
        this.pairedJsonPath = path.join(home, '.openclaw', 'devices', 'paired.json');
    }

    getToken(): string {
        return this.cachedToken;
    }

    /**
     * Read paired.json and extract the current token for our device.
     * Returns the new token on success, null if device/file not found.
     * Safe to call concurrently — Node.js single-threaded, idempotent reads.
     */
    async refresh(): Promise<string | null> {
        try {
            const raw = await fs.readFile(this.pairedJsonPath, 'utf-8');
            const devices = JSON.parse(raw);
            const device = devices[this.deviceId];
            const freshToken = device?.tokens?.operator?.token;
            if (freshToken && freshToken !== this.cachedToken) {
                console.error(`[token-provider] token rotated, updated cache`);
                this.cachedToken = freshToken;
            }
            return freshToken ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Auto-detect device ID by scanning paired.json for platform=linux.
     * Fallback when OPENCLAW_DEVICE_ID is not set in .env.
     */
    static async detectDeviceId(): Promise<string | null> {
        try {
            const home = process.env.HOME || '/data/data/com.termux/files/home';
            const p = path.join(home, '.openclaw', 'devices', 'paired.json');
            const raw = await fs.readFile(p, 'utf-8');
            const devices = JSON.parse(raw);
            for (const [id, device] of Object.entries(devices) as any) {
                if (device.platform === 'linux' || device.clientId === 'gateway-client') {
                    return id;
                }
            }
        } catch {}
        return null;
    }
}
