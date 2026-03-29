import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { OpenClawGatewayClient } from './gateway/client.js';

import { agentStatusTool, handleAgentStatus } from './tools/status.js';
import { sendTool, handleSend } from './tools/send.js';
import { sessionsTool, handleSessionsList } from './tools/sessions.js';
import { doctorTool, handleDoctor } from './tools/doctor.js';
import { logsTool, handleLogs } from './tools/logs.js';
import { restartTool, handleRestart } from './tools/restart.js';
import { shellExecTool, handleShellExec } from './tools/shell_exec.js';

import { currentActionsTool, handleCurrentActions } from './tools/current_actions.js';
import { systemHealthTool, handleSystemHealth } from './tools/system_health.js';
import { sessionsDetailTool, handleSessionsDetail } from './tools/sessions_detail.js';
import { strReplaceTool, handleStrReplace } from './tools/str_replace.js';
import { fileWriteTool, handleFileWrite } from './tools/file_write.js';
import { fileReadTool, handleFileRead } from './tools/file_read.js';
import { fileSearchTool, handleFileSearch } from './tools/file_search.js';
import { openclawConfigTool, handleOpenclawConfig } from './tools/openclaw_config.js';

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
                restartTool,
                shellExecTool,
                currentActionsTool,
                systemHealthTool,
                sessionsDetailTool,
                strReplaceTool,
                fileWriteTool,
                fileReadTool,
                fileSearchTool,
                openclawConfigTool
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

            case shellExecTool.name:
                return handleShellExec(client, request.params.arguments || {});

            case currentActionsTool.name:
                return handleCurrentActions(client, request.params.arguments || {});

            case systemHealthTool.name:
                return handleSystemHealth(client, request.params.arguments || {});

            case sessionsDetailTool.name:
                return handleSessionsDetail(client, request.params.arguments || {});

            case strReplaceTool.name:
                return handleStrReplace(client, request.params.arguments || {});

            case fileWriteTool.name:
                return handleFileWrite(client, request.params.arguments || {});

            case fileReadTool.name:
                return handleFileRead(client, request.params.arguments || {});

            case fileSearchTool.name:
                return handleFileSearch(client, request.params.arguments || {});

            case openclawConfigTool.name:
                return handleOpenclawConfig(client, request.params.arguments || {});

            default:
                throw new Error(`Unknown tool: ${request.params.name}`);
        }
    });

    return server;
}
