import * as http from 'node:http';

export function checkBearerToken(req: http.IncomingMessage, bridgeToken: string): boolean {
    if (!bridgeToken) {
        return false;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.split(' ')[1];
    return token === bridgeToken;
}

export function handleUnauthorized(res: http.ServerResponse) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing BRIDGE_TOKEN' }));
}
