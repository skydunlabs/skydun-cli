import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { main, parseArgs } from '../src/cli.js';
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
    assert.deepEqual(parseArgs(['-h', 'deploy']), {
        command: 'deploy',
        args: [],
        options: { help: true },
    });
    assert.deepEqual(parseArgs(['help', 'deploy']), {
        command: 'help',
        args: ['deploy'],
        options: {},
    });
    assert.throws(
        () => parseArgs(['deploy', '--site']),
        /--site needs a value/,
    );
});

test('an option no command has is refused, so a typo does not pass unnoticed', () => {
    assert.throws(
        () => parseArgs(['deploy', '--messsage', 'x']),
        /Unknown option --messsage/,
    );
    assert.throws(() => parseArgs(['deploy', '-m', 'x']), /Unknown option -m/);
    assert.throws(
        () => parseArgs(['deploy', '--no-site']),
        /Unknown option --no-site/,
    );
});

test('an unknown command or option exits 2 with a message', async () => {
    const errors = [];
    const error = console.error;
    console.error = (...parts) => errors.push(parts.join(' '));

    try {
        assert.equal(await main(['bogus']), 2);
        assert.equal(await main(['deploy', '--bogus']), 2);
    } finally {
        console.error = error;
    }

    assert.match(errors[0], /Unknown command: bogus/);
    assert.match(errors[1], /Unknown option --bogus/);
});

test('an HTML publish directory goes up prebuilt; the project folder itself and anything else is source', () => {
    const p = resolve('/p');

    assert.deepEqual(resolveUpload('html', p, 'dist', null), {
        root: join(p, 'dist'),
        prebuilt: true,
    });
    assert.deepEqual(
        resolveUpload('html', p, undefined, { directory: 'out' }),
        {
            root: join(p, 'out'),
            prebuilt: true,
        },
    );
    assert.deepEqual(
        resolveUpload('laravel', p, undefined, { directory: 'dist' }),
        {
            root: p,
            prebuilt: false,
        },
    );

    for (const spelling of ['.', './', p, 'a/..']) {
        assert.deepEqual(
            resolveUpload('html', p, spelling, null),
            { root: p, prebuilt: false },
            `skydun deploy ${spelling}`,
        );
        assert.deepEqual(
            resolveUpload('html', p, undefined, { directory: spelling }),
            { root: p, prebuilt: false },
            `directory ${spelling} in skydun.json`,
        );
    }
});
