import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
    ApiError,
    createClient,
    followDeployment,
    friendlyMessage,
} from '../src/api.js';
import { main } from '../src/cli.js';
import { packArchive } from '../src/pack.js';
import { fixture } from './helpers.js';

const OUTPUT =
    '==> Creating release\n==> Running deploy script\n==> Deployed release\n';
const SITES = [
    {
        uuid: 'site-1',
        name: 'Shop',
        domain: 'shop.test',
        type: 'html',
        workspace: { slug: 'acme', name: 'Acme' },
        url: 'https://panel/sites/shop',
    },
    {
        uuid: 'site-2',
        name: 'Blog',
        domain: null,
        type: 'nextjs',
        workspace: { slug: 'acme', name: 'Acme' },
        url: 'https://panel/sites/blog',
    },
];
let server;
let url;
let uploads = [];
let polls = [];
/** Statuses the next polls answer with before serving normally. */
let failNext = [];
const savedEnv = {};

before(async () => {
    server = http.createServer((req, res) => {
        const json = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };

        if (req.headers.authorization === 'Bearer html') {
            res.writeHead(200, { 'Content-Type': 'text/html' });

            return res.end('<html><body>Sign in</body></html>');
        }

        if (req.headers.authorization !== 'Bearer good') {
            return json(401, { message: 'Unauthenticated.' });
        }

        const path = new URL(req.url, 'http://x');

        if (path.pathname === '/api/v1/user') {
            return json(200, { name: 'Ada', email: 'ada@example.test' });
        }

        if (path.pathname === '/api/v1/sites') {
            return json(200, { data: SITES });
        }

        if (
            req.method === 'POST' &&
            path.pathname === '/api/v1/sites/busy/deployments'
        ) {
            req.resume();

            return req.on('end', () =>
                json(409, {
                    message:
                        'The website must be ready before it can be deployed.',
                }),
            );
        }

        if (
            req.method === 'POST' &&
            path.pathname === '/api/v1/sites/site-1/deployments'
        ) {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));

            return req.on('end', () => {
                uploads.push({
                    headers: req.headers,
                    body: Buffer.concat(chunks),
                });
                json(202, {
                    deployment: {
                        uuid: 'dep-1',
                        status: 'pending',
                        url: 'https://panel/deployments/dep-1',
                    },
                });
            });
        }

        if (path.pathname === '/api/v1/sites/site-1/deployments/dep-1') {
            if (failNext.length > 0) {
                return json(failNext.shift(), {
                    message: 'The panel is busy.',
                });
            }

            // Output arrives in three steps; the client must pass back each offset.
            const offset = Number(path.searchParams.get('offset'));
            polls.push(offset);
            const available = Math.min(OUTPUT.length, polls.length * 25);
            const done = available === OUTPUT.length;

            return json(200, {
                uuid: 'dep-1',
                status: done ? 'succeeded' : 'running',
                output: OUTPUT.slice(offset, available),
                offset: available,
                errorMessage: null,
                url: 'https://panel/deployments/dep-1',
            });
        }

        json(404, { message: 'Not found.' });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;

    for (const name of ['SKYDUN_URL', 'SKYDUN_TOKEN', 'XDG_CONFIG_HOME']) {
        savedEnv[name] = process.env[name];
    }

    process.env.SKYDUN_URL = url;
    process.env.SKYDUN_TOKEN = 'good';
    process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'skydun-cfg-'));
});

after(() => {
    server.close();

    for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
});

/** Run the CLI with what it prints captured. */
async function run(argv, context) {
    const out = [];
    const err = [];
    const write = process.stdout.write;
    const log = console.log;
    const error = console.error;
    // The test runner itself writes Buffers here; only the CLI writes strings.
    process.stdout.write = (chunk, ...rest) =>
        typeof chunk === 'string'
            ? (out.push(chunk), true)
            : write.call(process.stdout, chunk, ...rest);
    console.log = (...parts) => out.push(parts.join(' ') + '\n');
    console.error = (...parts) => err.push(parts.join(' ') + '\n');

    try {
        return {
            code: await main(argv, context),
            out: out.join(''),
            err: err.join(''),
        };
    } finally {
        process.stdout.write = write;
        console.log = log;
        console.error = error;
    }
}

test('following a deployment passes back each offset and prints the output once', async () => {
    polls = [];
    let printed = '';
    const finished = await followDeployment(
        createClient({ url, token: 'good' }),
        'site-1',
        'dep-1',
        {
            intervalMs: 1,
            onOutput: (chunk) => (printed += chunk),
        },
    );

    assert.equal(finished.status, 'succeeded');
    assert.equal(printed, OUTPUT);
    assert.deepEqual(
        polls,
        Array.from({ length: Math.ceil(OUTPUT.length / 25) }, (_, i) => i * 25),
    );
});

test('a poll that fails because the panel is busy or down is tried again', async () => {
    const client = createClient({ url, token: 'good' });
    polls = [];
    failNext = [502, 429];
    let printed = '';
    const finished = await followDeployment(client, 'site-1', 'dep-1', {
        intervalMs: 1,
        onOutput: (chunk) => (printed += chunk),
    });

    assert.equal(finished.status, 'succeeded');
    assert.equal(printed, OUTPUT);
    assert.deepEqual(failNext, []);

    polls = [];
    failNext = [503, 503, 503];
    const givenUp = await followDeployment(client, 'site-1', 'dep-1', {
        intervalMs: 1,
        retries: 2,
    }).catch((e) => e);

    assert.equal(givenUp.status, 503);
    assert.deepEqual(failNext, []);

    const missing = await followDeployment(client, 'site-1', 'dep-9', {
        intervalMs: 1,
    }).catch((e) => e);

    assert.equal(missing.status, 404);
});

test('a refused token sends people to login, other errors show the panel message', async () => {
    const error = await createClient({ url, token: 'bad' })
        .user()
        .catch((e) => e);

    assert.ok(error instanceof ApiError);
    assert.equal(
        friendlyMessage(error),
        'Your token was refused. Run skydun login.',
    );

    const conflict = await createClient({ url, token: 'good' })
        .deploy('busy', await fixtureArchive(), {})
        .catch((e) => e);
    assert.equal(conflict.status, 409);
    assert.equal(
        friendlyMessage(conflict),
        'The website must be ready before it can be deployed.',
    );

    assert.equal(
        friendlyMessage(
            new ApiError(422, 'The archive field is required.', {
                archive: ['The archive field is required.'],
                message: ['Too long.'],
            }),
        ),
        'The archive field is required.\n  Too long.',
    );

    const page = await createClient({ url, token: 'html' })
        .user()
        .catch((e) => e);
    assert.ok(page instanceof ApiError);
    assert.match(
        friendlyMessage(page),
        /answered 200 with something that is not JSON/,
    );
});

test('skydun deploy uploads a prebuilt HTML folder as multipart and follows the build', async () => {
    uploads = [];
    polls = [];
    const project = await fixture({
        'skydun.json': JSON.stringify({
            site: 'site-1',
            type: 'html',
            directory: 'dist',
        }),
        'dist/index.html': '<h1>Shop</h1>',
        'src/main.js': '',
    });

    const { code, out } = await run(['deploy', '--message', 'Launch'], {
        cwd: project,
        pollIntervalMs: 1,
    });

    const upload = uploads[0];
    assert.ok(upload, 'the archive was uploaded');
    const body = upload.body.toString('latin1');

    assert.equal(code, 0);
    assert.match(
        upload.headers['content-type'],
        /^multipart\/form-data; boundary=/,
    );
    assert.equal(Number(upload.headers['content-length']), upload.body.length);
    assert.match(body, /name="message"\r\n\r\nLaunch\r\n/);
    assert.match(body, /name="prebuilt"\r\n\r\n1\r\n/);
    assert.ok(
        body.includes(
            'name="archive"; filename="source.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n\u001f\u008b',
        ),
    );
    assert.match(out, /Packed 1 files/);
    assert.match(out, /Uploading/);
    assert.ok(out.includes(OUTPUT));
    assert.ok(out.includes('Deployed.'));
});

test('skydun link --site writes skydun.json without asking', async () => {
    const project = await fixture({ 'package.json': '{}' });
    const { code, out } = await run(['link', '--site', 'site-2'], {
        cwd: project,
    });

    assert.equal(code, 0);
    assert.match(out, /Linked to Blog/);
    assert.deepEqual(
        JSON.parse(await readFile(join(project, 'skydun.json'), 'utf8')),
        { site: 'site-2', type: 'nextjs' },
    );

    const { code: refused, err } = await run(['link', '--site', 'site-9'], {
        cwd: project,
    });
    assert.equal(refused, 1);
    assert.match(err, /No website you may deploy has the uuid site-9/);
});

test('skydun whoami shows the token owner and the panel', async () => {
    const { code, out } = await run(['whoami']);

    assert.equal(code, 0);
    assert.equal(out, `Ada (ada@example.test) on ${url}\n`);
});

async function fixtureArchive() {
    return (await packArchive(await fixture({ 'index.html': '' }), 'html'))
        .path;
}
