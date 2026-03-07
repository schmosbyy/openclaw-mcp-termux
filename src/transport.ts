import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as http from 'node:http';

export function createTransport(mode: 'stdio' | 'http') {
    if (mode === 'http') {
        return new StreamableHTTPServerTransport();
    }
    return new StdioServerTransport();
}
