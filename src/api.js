import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { basename } from 'node:path';

/** How long a request may take before the panel counts as unreachable. */
const REQUEST_TIMEOUT_MS = 30_000;

/** The statuses a deployment is still being worked on in. */
const IN_PROGRESS = new Set(['pending', 'running']);

/** The panel answered, but refused. */
export class ApiError extends Error {
    constructor(status, message, errors = null) {
        super(message);
        this.status = status;
        this.errors = errors;
    }

    /** Whether a later try may well succeed: the panel was busy or down. */
    get transient() {
        return this.status === 408 || this.status === 429 || this.status >= 500;
    }
}

/** The panel could not be reached, or did not answer in time. */
export class NetworkError extends Error {}

/**
 * The message to show for a failed request: a refused token sends people
 * back to login, anything else shows what the panel said.
 */
export function friendlyMessage(error) {
    if (!(error instanceof ApiError)) {
        return error?.message ?? String(error);
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

function toApiError(status, text) {
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

/** The JSON a successful response holds, or null for an empty one. */
function parseJson(text, status) {
    if (text === '') {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new ApiError(
            status,
            `The panel answered ${status} with something that is not JSON. Is the panel address right?`,
        );
    }
}

function unreachable(url, error) {
    const reason =
        error.name === 'TimeoutError'
            ? `no answer in ${REQUEST_TIMEOUT_MS / 1000} seconds`
            : (error.cause?.message ?? error.message);

    return new NetworkError(`Could not reach ${url}: ${reason}`);
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
        let text;

        try {
            response = await fetch(`${base}${path}`, {
                method,
                headers,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            text = await response.text();
        } catch (error) {
            throw unreachable(url, error);
        }

        if (!response.ok) {
            throw toApiError(response.status, text);
        }

        return parseJson(text, response.status);
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
        const file = createReadStream(archivePath);
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
                res.on('error', (error) =>
                    reject(unreachable(url.origin, error)),
                );
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(parseJson(text, res.statusCode));
                        } catch (error) {
                            reject(error);
                        }

                        return;
                    }

                    // Refused, maybe before the whole archive went up, as
                    // a proxy does over its size limit: stop sending.
                    file.destroy();
                    req.destroy();
                    reject(toApiError(res.statusCode, text));
                });
            },
        );

        req.on('error', (error) => reject(unreachable(url.origin, error)));

        let sent = 0;
        req.write(head);
        file.on('data', (chunk) => {
            sent += chunk.length;
            onProgress(sent, size);
        });
        file.on('error', (error) => {
            req.destroy();
            reject(error);
        });
        file.on('end', () => req.end(tail));
        file.pipe(req, { end: false });
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A failure that a later try may not repeat: the panel busy, down, or unreachable. */
function isTransient(error) {
    return (
        error instanceof NetworkError ||
        (error instanceof ApiError && error.transient)
    );
}

/**
 * Follow a deployment until it finishes, handing each new piece of output
 * to onOutput. A poll that fails for a passing reason is tried again, a
 * little later each time, before giving up. Resolves with the final
 * deployment.
 */
export async function followDeployment(
    client,
    site,
    deployment,
    { onOutput = () => {}, intervalMs = 2000, retries = 5 } = {},
) {
    let offset = 0;
    let failures = 0;

    for (;;) {
        let current;

        try {
            current = await client.deployment(site, deployment, offset);
            failures = 0;
        } catch (error) {
            if (!isTransient(error) || ++failures > retries) {
                throw error;
            }

            await sleep(intervalMs * failures);
            continue;
        }

        if (current.output) {
            onOutput(current.output);
        }

        if (typeof current.offset === 'number') {
            offset = current.offset;
        }

        if (!IN_PROGRESS.has(current.status)) {
            return current;
        }

        await sleep(intervalMs);
    }
}
