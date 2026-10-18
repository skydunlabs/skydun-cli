import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../src/cli.js';
import { resolveUpload } from '../src/commands/deploy.js';

test('arguments split into the command, positionals and options', () => {
    assert.deepEqual(
        parseArgs([
            'deploy',
            './dist',
            '--site',
            'abc',
            '--message=Fix nav',
            '--no-wait',
        ]),
        {
            command: 'deploy',
            args: ['./dist'],
            options: { site: 'abc', message: 'Fix nav', wait: false },
        },
    );
    assert.throws(
        () => parseArgs(['deploy', '--site']),
        /--site needs a value/,
    );
});

test('an HTML publish directory goes up prebuilt; anything else is source', () => {
    assert.deepEqual(resolveUpload('html', '/p', 'dist', null), {
        root: '/p/dist',
        prebuilt: true,
    });
    assert.deepEqual(
        resolveUpload('html', '/p', undefined, { directory: 'out' }),
        { root: '/p/out', prebuilt: true },
    );
    assert.deepEqual(
        resolveUpload('html', '/p', undefined, { directory: '.' }),
        { root: '/p', prebuilt: false },
    );
    assert.deepEqual(
        resolveUpload('laravel', '/p', undefined, { directory: 'dist' }),
        { root: '/p', prebuilt: false },
    );
});
