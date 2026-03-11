import 'dotenv/config';
import * as http from 'node:http';
import { OpenClawGatewayClient } from './gateway/client.js';
import { createServer } from './server.js';
import { createTransport } from './transport.js';
import { checkBearerToken, handleUnauthorized } from './auth.js';

async function main() {
    const gatewayUrl = process.env.OPENCLAW_URL || 'http://127.0.0.1:18789';
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';
    const bridgeToken = process.env.BRIDGE_TOKEN || '';
    const port = parseInt(process.env.PORT || '3000', 10);
    const timeoutMs = parseInt(process.env.OPENCLAW_TIMEOUT_MS || '660000', 10);

    const argvOptions = process.argv.includes('--transport')
        ? process.argv[process.argv.indexOf('--transport') + 1]
        : undefined;

    const envTransport = process.env.TRANSPORT;
    const transportMode = (argvOptions || envTransport || 'stdio') as 'stdio' | 'http';

    if (!gatewayToken) {
        console.error('ERROR: OPENCLAW_GATEWAY_TOKEN is required. Set it in your .env file or environment.');
        process.exit(1);
    }

    if (transportMode === 'http' && !bridgeToken) {
        console.error('ERROR: BRIDGE_TOKEN is required in remote HTTP mode. Generate one and add it to your .env');
        process.exit(1);
    }

    const client = new OpenClawGatewayClient(gatewayUrl, gatewayToken, timeoutMs);
    const mcpServer = createServer(client);
    const transport = createTransport(transportMode);

    if (transportMode === 'stdio') {
        await mcpServer.connect(transport);
        console.error(`Local Termux MCP Bridge started on stdio. Proxying to ${gatewayUrl}`);
    } else {
        // HTTP Mode
        const httpServer = http.createServer((req, res) => {
            // Basic CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            // Auth middleware
            if (!checkBearerToken(req, bridgeToken)) {
                handleUnauthorized(res);
                return;
            }

            // Delegate to MCP HTTP transport
            (transport as any).handleRequest(req, res);
        });

        await mcpServer.connect(transport);

        httpServer.listen(port, () => {
            console.error(`Remote Termux MCP Bridge started. Listening on HTTP port ${port}`);
            console.error(`Proxying to OpenClaw gateway at ${gatewayUrl}`);
        });
    }
}

main().catch(err => {
    console.error("Fatal error starting server:", err);
    process.exit(1);
});
