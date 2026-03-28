import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

export const strReplaceTool = {
    name: 'file_str_replace',
    description: 'Replace a unique string in a file with another string. old_str must match the raw file content exactly and appear exactly once. Use this instead of shell-based sed/python for all file edits — content goes through JSON parameters, never a shell, so there are no escaping issues.',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute path to the file to edit. Tilde (~) is expanded to the home directory.'
            },
            old_str: {
                type: 'string',
                description: 'The exact string to find. Must appear exactly once in the file.'
            },
            new_str: {
                type: 'string',
                description: 'The replacement string. Use empty string to delete old_str.'
            }
        },
        required: ['path', 'old_str']
    }
};

export async function handleStrReplace(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const rawPath = String(input.path || '').trim();
    const oldStr = String(input.old_str ?? '');
    const newStr = String(input.new_str ?? '');

    if (!rawPath) {
        return { isError: true, content: [{ type: 'text', text: 'path is required' }] };
    }
    if (!oldStr) {
        return { isError: true, content: [{ type: 'text', text: 'old_str is required and cannot be empty' }] };
    }

    // Expand tilde
    const resolvedPath = rawPath.replace(/^~(?=$|\/)/, os.homedir());

    try {
        const content = await fs.readFile(resolvedPath, 'utf-8');

        const occurrences = content.split(oldStr).length - 1;

        if (occurrences === 0) {
            return {
                isError: true,
                content: [{ type: 'text', text: `old_str not found in file. No changes made.` }]
            };
        }

        if (occurrences > 1) {
            return {
                isError: true,
                content: [{ type: 'text', text: `old_str appears ${occurrences} times in file — must be unique. Narrow it down.` }]
            };
        }

        // Exactly one occurrence — safe to replace
        const updated = content.replace(oldStr, newStr);
        await fs.writeFile(resolvedPath, updated, 'utf-8');

        const linesChanged = oldStr.split('\n').length;

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    ok: true,
                    path: resolvedPath,
                    lines_changed: linesChanged
                }, null, 2)
            }]
        };

    } catch (err: any) {
        let message = err.message || String(err);
        if (err.code === 'ENOENT') message = `File not found: ${resolvedPath}`;
        if (err.code === 'EACCES') message = `Permission denied: ${resolvedPath}`;
        return {
            isError: true,
            content: [{ type: 'text', text: message }]
        };
    }
}
