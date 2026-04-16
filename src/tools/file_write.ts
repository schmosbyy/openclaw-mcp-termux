import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export const fileWriteTool = {
    name: 'file_write',
    description: 'Create or overwrite a file with the given content. Content goes through JSON parameters — never a shell — so there are no escaping or newline-stripping issues. Automatically creates parent directories if they do not exist. Use this for new files and full rewrites. For targeted edits to existing files, use file_edit instead.',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute path to the file to write. Tilde (~) is expanded to the home directory.'
            },
            content: {
                type: 'string',
                description: 'Full file content to write.'
            }
        },
        required: ['path', 'content']
    }
};

export async function handleFileWrite(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const rawPath = String(input.path || '').trim();
    const content = String(input.content ?? '');

    if (!rawPath) {
        return { isError: true, content: [{ type: 'text', text: 'path is required' }] };
    }

    const resolvedPath = rawPath.replace(/^~(?=$|\/)/, os.homedir());

    try {
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, content, 'utf-8');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    ok: true,
                    path: resolvedPath,
                    lines_written: content.split('\n').length,
                    bytes_written: Buffer.byteLength(content, 'utf-8')
                }, null, 2)
            }]
        };

    } catch (err: any) {
        let message = err.message || String(err);
        if (err.code === 'EACCES') message = `Permission denied: ${resolvedPath}`;
        return {
            isError: true,
            content: [{ type: 'text', text: message }]
        };
    }
}
