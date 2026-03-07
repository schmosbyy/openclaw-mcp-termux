import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { OpenClawGatewayClient } from './gateway/client.js';

import { agentStatusTool, handleAgentStatus } from './tools/status.js';
import { sendTool, handleSend } from './tools/send.js';
import { sessionsTool, handleSessionsList } from './tools/sessions.js';
import { doctorTool, handleDoctor } from './tools/doctor.js';
import { logsTool, handleLogs } from './tools/logs.js';
import { restartTool, handleRestart } from './tools/restart.js';

export function createServer(client: OpenClawGatewayClient): Server {
    const server = new Server(
        {
            name: 'openclaw-mcp-termux',
            version: '0.1.0'
        },
        {
            capabilities: {
                tools: {}
            }
        }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                sendTool,
                agentStatusTool,
                sessionsTool,
                doctorTool,
                logsTool,
                restartTool
            ]
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        switch (request.params.name) {
            case sendTool.name:
                return handleSend(client, request.params.arguments || {});

            case agentStatusTool.name:
                return handleAgentStatus(client);

            case sessionsTool.name:
                return handleSessionsList(client, request.params.arguments || {});

            case doctorTool.name:
                return handleDoctor(client, request.params.arguments || {});

            case logsTool.name:
                return handleLogs(client, request.params.arguments || {});

            case restartTool.name:
                return handleRestart(client, request.params.arguments || {});

            default:
                throw new Error(`Unknown tool: ${request.params.name}`);
        }
    });

    return server;
}
