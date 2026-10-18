import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPublishDirectory, detectType } from '../src/detect.js';
import { fixture } from './helpers.js';

test('a folder with artisan is Laravel, even with Next.js files', async () => {
    assert.equal(
        detectType(await fixture({ artisan: '', 'next.config.js': '' })),
        'laravel',
    );
});

test('a next.config or a next dependency makes it Next.js', async () => {
    assert.equal(
        detectType(await fixture({ 'next.config.mjs': '' })),
        'nextjs',
    );
    assert.equal(
        detectType(
            await fixture({
                'package.json': JSON.stringify({
                    dependencies: { next: '15.0.0' },
                }),
            }),
        ),
        'nextjs',
    );
});

test('anything else is HTML', async () => {
    assert.equal(
        detectType(
            await fixture({
                'index.html': '',
                'package.json': '{"dependencies":{"vite":"6"}}',
            }),
        ),
        'html',
    );
    assert.equal(
        detectType(await fixture({ 'package.json': 'not json' })),
        'html',
    );
});

test('an HTML website publishes dist when it exists', async () => {
    assert.equal(
        defaultPublishDirectory(await fixture({ 'dist/index.html': '' })),
        'dist',
    );
    assert.equal(
        defaultPublishDirectory(await fixture({ 'index.html': '' })),
        '.',
    );
});
