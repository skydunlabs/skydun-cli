import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
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
import { fixture } from './helpers.js';

const OUTPUT =
    '==> Creating release\n==> Running deploy script\n==> Deployed release\n';
let server;
let url;
let uploads = [];
let polls = [];

before(async () => {
    server = http.createServer((req, res) => {
        const json = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };

        if (req.headers.authorization !== 'Bearer good') {
            return json(401, { message: 'Unauthenticated.' });
        }

        const path = new URL(req.url, 'http://x');

        if (path.pathname === '/api/v1/user') {
            return json(200, { name: 'Ada', email: 'ada@example.test' });
        }

        if (path.pathname === '/api/v1/sites') {
            return json(200, {
                data: [
                    {
                        uuid: 'site-1',
                        name: 'Shop',
                        domain: 'shop.test',
                        type: 'html',
                        workspace: { slug: 'acme', name: 'Acme' },
                        url: 'https://panel/sites/shop',
                    },
                ],
            });
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
});

after(() => server.close());

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

    process.env.SKYDUN_URL = url;
    process.env.SKYDUN_TOKEN = 'good';
    process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'skydun-cfg-'));
    process.chdir(project);

    const lines = [];
    const write = process.stdout.write.bind(process.stdout);
    const log = console.log;
    process.stdout.write = (chunk) => (lines.push(String(chunk)), true);
    console.log = (...parts) => lines.push(parts.join(' ') + '\n');

    let code;

    try {
        code = await main(['deploy', '--message', 'Launch']);
    } finally {
        process.stdout.write = write;
        console.log = log;
    }

    const upload = uploads[0];
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
    assert.ok(lines.join('').includes(OUTPUT));
    assert.ok(lines.join('').includes('Deployed.'));
});

async function fixtureArchive() {
    const { packArchive } = await import('../src/pack.js');

    return (await packArchive(await fixture({ 'index.html': '' }), 'html'))
        .path;
}
