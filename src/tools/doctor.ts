import { OpenClawGatewayClient } from '../gateway/client.js';

export const doctorTool = {
    name: 'openclaw_doctor',
    description: 'Run openclaw doctor to diagnose and repair the gateway. If fix=true, runs auto-repair.',
    inputSchema: {
        type: 'object',
        properties: {
            fix: {
                type: 'boolean',
                description: 'If true, runs auto-repair and backs up config to ~/.openclaw/openclaw.json.bak. Remind the user before running this.',
                default: false
            },
            non_interactive: {
                type: 'boolean',
                description: 'Passes --non-interactive to skip confirmation prompts. Mandatory for programmatic use.',
                default: true
            },
            deep: {
                type: 'boolean',
                description: 'Passes --deep to add system-level scans and live channel probes.',
                default: false
            },
            json: {
                type: 'boolean',
                description: 'Passes --json to return machine-readable output.',
                default: true
            }
        },
        required: []
    }
};

export async function handleDoctor(client: OpenClawGatewayClient, input: any) {
    const fix = input.fix ?? false;
    const nonInteractive = input.non_interactive ?? true;
    const deep = input.deep ?? false;
    const json = input.json ?? true;

    try {
        const response = await client.runDoctor(fix, nonInteractive, deep, json);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(response, null, 2)
                }
            ]
        };
    } catch (err: any) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        error: {
                            code: err.code || 'UNKNOWN_ERROR',
                            message: err.message,
                            hint: err.hint
                        }
                    }, null, 2)
                }
            ]
        };
    }
}
