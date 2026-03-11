import { OpenClawGatewayClient } from '../gateway/client.js';

export const doctorTool = {
    name: 'openclaw_doctor',
    description: 'Run openclaw doctor to diagnose and repair the gateway. Supports --fix and --non-interactive flags only.',
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
            }
        },
        required: []
    }
};

export async function handleDoctor(client: OpenClawGatewayClient, input: any) {
    const fix = input.fix ?? false;
    const nonInteractive = input.non_interactive ?? true;

    try {
        const response = await client.runDoctor(fix, nonInteractive);
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
