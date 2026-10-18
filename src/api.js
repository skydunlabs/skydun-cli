import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { basename } from 'node:path';

export class ApiError extends Error {
    constructor(status, message, errors = null) {
        super(message);
        this.status = status;
        this.errors = errors;
    }
}

/**
 * The message to show for a failed request: a refused token sends people
 * back to login, anything else shows what the panel said.
 */
export function friendlyMessage(error) {
    if (!(error instanceof ApiError)) {
        return error.message;
    }

    if (error.status === 401) {
        return 'Your token was refused. Run skydun login.';
    }

    const message = error.message || `The panel answered ${error.status}.`;
    const details = error.errors
        ? Object.values(error.errors)
              .flat()
              .filter((detail) => detail && detail !== message)
        : [];

    return details.length > 0
        ? `${message}\n  ${details.join('\n  ')}`
        : message;
}

async function toApiError(status, text) {
    let body = null;

    try {
        body = JSON.parse(text);
    } catch {
        // Not JSON: a proxy or server error page.
    }

    const fallback = {
        401: 'Unauthenticated.',
        403: 'You may not do that.',
        404: 'Not found.',
        413: 'The archive is too large for the panel.',
        429: 'Too many requests. Try again in a minute.',
    }[status];

    return new ApiError(
        status,
        body?.message || fallback || `The panel answered ${status}.`,
        body?.errors ?? null,
    );
}

export function createClient({ url, token }) {
    const base = `${url}/api/v1`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'skydun-cli',
    };

    async function request(method, path) {
        let response;

        try {
            response = await fetch(`${base}${path}`, { method, headers });
        } catch (error) {
            throw new Error(
                `Could not reach ${url}: ${error.cause?.message ?? error.message}`,
            );
        }

        const text = await response.text();

        if (!response.ok) {
            throw await toApiError(response.status, text);
        }

        return text === '' ? null : JSON.parse(text);
    }

    return {
        user: () => request('GET', '/user'),
        sites: async () => (await request('GET', '/sites'))?.data ?? [],
        deployment: (site, deployment, offset = 0) =>
            request(
                'GET',
                `/sites/${encodeURIComponent(site)}/deployments/${encodeURIComponent(deployment)}?offset=${offset}`,
            ),
        deploy: (site, archivePath, fields, onProgress) =>
            uploadMultipart(
                `${base}/sites/${encodeURIComponent(site)}/deployments`,
                headers,
                archivePath,
                fields,
                onProgress,
            ),
    };
}

/**
 * POST the archive as multipart/form-data, streamed from disk so large
 * archives never sit in memory, reporting bytes sent as it goes.
 */
async function uploadMultipart(
    target,
    headers,
    archivePath,
    fields,
    onProgress = () => {},
) {
    const boundary = `----skydun${randomBytes(12).toString('hex')}`;
    const size = (await stat(archivePath)).size;
    const parts = Object.entries(fields)
        .filter(
            ([, value]) =>
                value !== undefined && value !== null && value !== '',
        )
        .map(
            ([name, value]) =>
                `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        )
        .join('');
    const head = Buffer.from(
        `${parts}--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="${basename(archivePath)}"\r\nContent-Type: application/gzip\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const url = new URL(target);
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = transport.request(
            url,
            {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': head.length + size + tail.length,
                },
            },
            (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (text += chunk));
                res.on('end', async () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(text === '' ? null : JSON.parse(text));
                    } else {
                        reject(await toApiError(res.statusCode, text));
                    }
                });
            },
        );

        req.on('error', (error) =>
            reject(
                new Error(`Could not reach ${url.origin}: ${error.message}`),
            ),
        );

        let sent = 0;
        req.write(head);
        const file = createReadStream(archivePath);
        file.on('data', (chunk) => {
            sent += chunk.length;
            onProgress(sent, size);
        });
        file.on('error', reject);
        file.on('end', () => req.end(tail));
        file.pipe(req, { end: false });
    });
}

/**
 * Follow a deployment until it finishes, handing each new piece of output
 * to onOutput. Resolves with the final deployment.
 */
export async function followDeployment(
    client,
    site,
    deployment,
    { onOutput = () => {}, intervalMs = 2000, signal } = {},
) {
    let offset = 0;

    for (;;) {
        const current = await client.deployment(site, deployment, offset);

        if (current.output) {
            onOutput(current.output);
        }

        if (typeof current.offset === 'number') {
            offset = current.offset;
        }

        if (current.status === 'succeeded' || current.status === 'failed') {
            return current;
        }

        if (signal?.aborted) {
            return current;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}
