import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { OpenClawGatewayClient } from './gateway/client.js';

import { agentDispatchTool, handleAgentDispatch } from './tools/agent_dispatch.js';
import { agentQueryTool, handleAgentQuery } from './tools/agent_query.js';
import { agentControlTool, handleAgentControl } from './tools/agent_control.js';
import { openclawCliTool, handleOpenclawCli } from './tools/openclaw_cli.js';

import { fileReadTool, handleFileRead } from './tools/file_read.js';
import { fileWriteTool, handleFileWrite } from './tools/file_write.js';
import { fileEditTool, handleFileEdit } from './tools/file_edit.js';
import { fileSearchTool, handleFileSearch } from './tools/file_search.js';
import { shellExecTool, handleShellExec } from './tools/shell_exec.js';
import { systemHealthTool, handleSystemHealth } from './tools/system_health.js';

export function createServer(client: OpenClawGatewayClient): Server {
    const server = new Server(
        {
            name: 'openclaw-mcp-termux',
            version: '0.2.0'
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
                agentDispatchTool,
                agentQueryTool,
                agentControlTool,
                openclawCliTool,
                fileReadTool,
                fileWriteTool,
                fileEditTool,
                fileSearchTool,
                shellExecTool,
                systemHealthTool
            ]
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        switch (request.params.name) {
            case agentDispatchTool.name:
                return handleAgentDispatch(client, request.params.arguments || {});

            case agentQueryTool.name:
                return handleAgentQuery(client, request.params.arguments || {});

            case agentControlTool.name:
                return handleAgentControl(client, request.params.arguments || {});

            case openclawCliTool.name:
                return handleOpenclawCli(client, request.params.arguments || {});

            case fileReadTool.name:
                return handleFileRead(client, request.params.arguments || {});

            case fileWriteTool.name:
                return handleFileWrite(client, request.params.arguments || {});

            case fileEditTool.name:
                return handleFileEdit(client, request.params.arguments || {});

            case fileSearchTool.name:
                return handleFileSearch(client, request.params.arguments || {});

            case shellExecTool.name:
                return handleShellExec(client, request.params.arguments || {});

            case systemHealthTool.name:
                return handleSystemHealth(client, request.params.arguments || {});

            default:
                throw new Error(`Unknown tool: ${request.params.name}`);
        }
    });

    return server;
}
