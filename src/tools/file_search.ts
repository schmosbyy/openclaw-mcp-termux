import { OpenClawGatewayClient } from '../gateway/client.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export const fileSearchTool = {
    name: 'file_search',
    description: 'Search for a literal string pattern in a file or recursively in a directory. Returns structured hits with surrounding context lines. Case-insensitive. Replaces grep -n. For regex searches, use shell_exec.',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute path to a file or directory. Tilde (~) is expanded to the home directory. Directories are searched recursively.'
            },
            pattern: {
                type: 'string',
                description: 'Search string. Treated as a case-insensitive literal (not regex).'
            },
            context_lines: {
                type: 'number',
                description: 'Number of lines to include before and after each match. Default 2, max 5.'
            },
            include_pattern: {
                type: 'string',
                description: 'Directory mode only: only search files whose name ends with this string. Example: ".ts" for TypeScript files. Omit to search all files.'
            },
            max_results: {
                type: 'number',
                description: 'Stop after this many total matches. Default 50, max 200.'
            }
        },
        required: ['path', 'pattern']
    }
};

// Directories / file suffixes to skip when walking a directory tree
const SKIP_DIRS  = new Set(['node_modules', '.git', 'dist', '.cache', '__pycache__']);
const SKIP_EXTS  = ['.sqlite', '.sqlite3', '.db', '.log', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bin', '.wasm', '.zip', '.tar', '.gz'];

interface SearchMatch {
    file: string;
    line_number: number;
    line: string;
    context_before: string[];
    context_after: string[];
}

function shouldSkipFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return SKIP_EXTS.some(ext => lower.endsWith(ext));
}

function searchLines(
    lines: string[],
    filePath: string,
    patternLower: string,
    ctx: number,
    maxResults: number,
    hits: SearchMatch[]
): number {
    let added = 0;
    for (let i = 0; i < lines.length && hits.length < maxResults; i++) {
        if (lines[i].toLowerCase().indexOf(patternLower) !== -1) {
            const before = lines.slice(Math.max(0, i - ctx), i);
            const after  = lines.slice(i + 1, Math.min(lines.length, i + 1 + ctx));
            hits.push({
                file: filePath,
                line_number: i + 1, // 1-indexed
                line: lines[i],
                context_before: before,
                context_after: after
            });
            added++;
        }
    }
    return added;
}

async function walkDir(
    dir: string,
    patternLower: string,
    ctx: number,
    includeSuffix: string | null,
    maxResults: number,
    hits: SearchMatch[],
    filesSearched: { count: number }
): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return; // Skip unreadable dirs silently
    }

    for (const entry of entries) {
        if (hits.length >= maxResults) break;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            await walkDir(fullPath, patternLower, ctx, includeSuffix, maxResults, hits, filesSearched);
        } else if (entry.isFile()) {
            if (shouldSkipFile(fullPath)) continue;
            if (includeSuffix && !entry.name.endsWith(includeSuffix)) continue;

            let text: string;
            try {
                text = await fs.readFile(fullPath, 'utf-8');
            } catch {
                continue; // Skip unreadable files
            }

            filesSearched.count++;
            const lines = text.split('\n');
            searchLines(lines, fullPath, patternLower, ctx, maxResults, hits);
        }
    }
}

export async function handleFileSearch(
    client: OpenClawGatewayClient,
    input: any
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const rawPath = String(input.path || '').trim();
    const pattern = String(input.pattern || '').trim();

    if (!rawPath) {
        return { isError: true, content: [{ type: 'text', text: 'path is required' }] };
    }
    if (!pattern) {
        return { isError: true, content: [{ type: 'text', text: 'pattern is required' }] };
    }

    const resolvedPath = rawPath.replace(/^~(?=$|\/)/, os.homedir());
    const patternLower = pattern.toLowerCase();

    let ctx = input.context_lines !== undefined ? Number(input.context_lines) : 2;
    if (isNaN(ctx) || ctx < 0) ctx = 2;
    if (ctx > 5) ctx = 5;

    let maxResults = input.max_results !== undefined ? Number(input.max_results) : 50;
    if (isNaN(maxResults) || maxResults <= 0) maxResults = 50;
    if (maxResults > 200) maxResults = 200;

    const includeSuffix: string | null = input.include_pattern ? String(input.include_pattern) : null;

    let stat: import('node:fs').Stats;
    try {
        stat = await fs.stat(resolvedPath);
    } catch (err: any) {
        let message = err.message || String(err);
        if (err.code === 'ENOENT')  message = `Path not found: ${resolvedPath}`;
        if (err.code === 'EACCES')  message = `Permission denied: ${resolvedPath}`;
        return { isError: true, content: [{ type: 'text', text: message }] };
    }

    const hits: SearchMatch[] = [];
    const filesSearched = { count: 0 };

    if (stat.isDirectory()) {
        await walkDir(resolvedPath, patternLower, ctx, includeSuffix, maxResults, hits, filesSearched);
    } else {
        let text: string;
        try {
            text = await fs.readFile(resolvedPath, 'utf-8');
        } catch (err: any) {
            let message = err.message || String(err);
            if (err.code === 'EACCES') message = `Permission denied: ${resolvedPath}`;
            return { isError: true, content: [{ type: 'text', text: message }] };
        }
        filesSearched.count = 1;
        const lines = text.split('\n');
        searchLines(lines, resolvedPath, patternLower, ctx, maxResults, hits);
    }

    const truncated = hits.length >= maxResults;

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                ok: true,
                path: resolvedPath,
                pattern,
                total_matches: hits.length,
                truncated,
                files_searched: filesSearched.count,
                matches: hits
            }, null, 2)
        }]
    };
}
