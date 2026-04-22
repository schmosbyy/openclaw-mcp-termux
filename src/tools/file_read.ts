import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import { resolvePath } from '../utils/paths.js';

export const fileReadTool = {
    name: 'file_read',
    description: 'Read an entire file or a specific line range. Content comes back through JSON — no shell, no escaping issues. Use start_line / end_line for large files. Output is capped at 2000 lines.',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute path to the file. Tilde (~) is expanded to the proot home directory.'
            },
            start_line: {
                type: 'number',
                description: '1-indexed first line to return. If omitted, read from line 1.'
            },
            end_line: {
                type: 'number',
                description: '1-indexed last line to return (inclusive). If omitted, read to end of file.'
            }
        },
        required: ['path']
    }
};

const MAX_LINES = 2000;

export async function handleFileRead(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const rawPath = String(input.path || '').trim();

    if (!rawPath) {
        return { isError: true, content: [{ type: 'text', text: 'path is required' }] };
    }

    const resolvedPath = resolvePath(rawPath);

    // Validate line range inputs before reading
    const hasStart = input.start_line !== undefined && input.start_line !== null;
    const hasEnd   = input.end_line   !== undefined && input.end_line   !== null;

    const startLineReq = hasStart ? Number(input.start_line) : 1;
    const endLineReq   = hasEnd   ? Number(input.end_line)   : Infinity;

    if (hasStart && (!Number.isInteger(startLineReq) || startLineReq < 1)) {
        return { isError: true, content: [{ type: 'text', text: 'start_line must be a positive integer >= 1' }] };
    }
    if (hasEnd && (!Number.isInteger(endLineReq) || endLineReq < 1)) {
        return { isError: true, content: [{ type: 'text', text: 'end_line must be a positive integer >= 1' }] };
    }
    if (hasStart && hasEnd && startLineReq > endLineReq) {
        return { isError: true, content: [{ type: 'text', text: 'start_line must be <= end_line' }] };
    }

    try {
        const raw = await fs.readFile(resolvedPath, 'utf-8');
        const allLines = raw.split('\n');
        const totalLines = allLines.length;

        // Convert 1-indexed inclusive range to 0-indexed slice bounds
        const sliceStart = startLineReq - 1;                              // 0-indexed
        const sliceEnd   = endLineReq === Infinity ? totalLines : Math.min(endLineReq, totalLines); // exclusive

        let lines = allLines.slice(sliceStart, sliceEnd);

        let truncated = false;
        if (lines.length > MAX_LINES) {
            lines = lines.slice(0, MAX_LINES);
            truncated = true;
        }

        const actualStart = sliceStart + 1;                           // back to 1-indexed
        const actualEnd   = sliceStart + lines.length;               // 1-indexed inclusive

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    ok: true,
                    path: resolvedPath,
                    content: lines.join('\n'),
                    line_count: lines.length,
                    start_line: actualStart,
                    end_line: actualEnd,
                    truncated
                }, null, 2)
            }]
        };

    } catch (err: any) {
        let message = err.message || String(err);
        if (err.code === 'ENOENT')  message = `File not found: ${resolvedPath}`;
        if (err.code === 'EISDIR')  message = `Path is a directory — use file_search instead: ${resolvedPath}`;
        if (err.code === 'EACCES')  message = `Permission denied: ${resolvedPath}`;
        return {
            isError: true,
            content: [{ type: 'text', text: message }]
        };
    }
}
