import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as tar from 'tar';
import { listFiles, packArchive } from '../src/pack.js';
import { fixture } from './helpers.js';

test('a Laravel upload leaves out dependencies, secrets, runtime storage and ignored files', async () => {
    const root = await fixture({
        artisan: '',
        'app/Models/User.php': '',
        '.env': 'SECRET=1',
        '.env.production': 'SECRET=2',
        '.env.example': 'APP_NAME=',
        'vendor/autoload.php': '',
        'node_modules/x/index.js': '',
        'storage/logs/laravel.log': '',
        'storage/framework/views/a.php': '',
        'storage/app/.gitignore': '*',
        'bootstrap/cache/config.php': '',
        'bootstrap/cache/.gitignore': '*',
        'public/hot': '',
        'public/index.php': '',
        '.git/HEAD': '',
        '.gitignore': '/coverage\n',
        'coverage/index.html': '',
        '.skydunignore': 'docs/\n',
        'docs/readme.md': '',
        'skydun.json': '{}',
    });

    assert.deepEqual(await listFiles(root, 'laravel'), [
        '.env.example',
        '.gitignore',
        'app/Models/User.php',
        'artisan',
        'bootstrap/cache/.gitignore',
        'public/index.php',
        'storage/app/.gitignore',
    ]);
});

test('a Next.js upload leaves out node_modules, .next and env files', async () => {
    const root = await fixture({
        'package.json': '{}',
        'app/page.tsx': '',
        '.next/BUILD_ID': '',
        'node_modules/next/index.js': '',
        '.env.local': 'SECRET=1',
        '.env.example': '',
    });

    assert.deepEqual(await listFiles(root, 'nextjs'), [
        '.env.example',
        'app/page.tsx',
        'package.json',
    ]);
});

test('.skydunignore can take back a path .gitignore leaves out', async () => {
    const root = await fixture({
        'index.html': '',
        'dist/app.js': '',
        '.gitignore': 'dist/\n',
        '.skydunignore': '!dist/\n',
    });

    assert.deepEqual(await listFiles(root, 'html'), [
        '.gitignore',
        'dist/app.js',
        'index.html',
    ]);
});

test('a prebuilt folder goes up whole, ignore files and all', async () => {
    const root = await fixture({
        'index.html': '',
        'assets/app.js': '',
        '.gitignore': 'assets/\n',
    });

    assert.deepEqual(await listFiles(root, 'html', { prebuilt: true }), [
        '.gitignore',
        'assets/app.js',
        'index.html',
    ]);
});

test('the archive holds the files at its root and keeps symlinks as links', async () => {
    const root = await fixture(
        { 'index.html': '<h1>hi</h1>', 'css/app.css': '' },
        { outside: '/etc' },
    );
    const archive = await packArchive(root, 'html', { prebuilt: true });
    const entries = [];

    await tar.list({
        file: archive.path,
        onReadEntry: (entry) => entries.push([entry.path, entry.type]),
    });

    assert.equal(archive.files, 3);
    assert.deepEqual(entries.sort(), [
        ['css/app.css', 'File'],
        ['index.html', 'File'],
        ['outside', 'SymbolicLink'],
    ]);

    const out = await mkdtemp(join(tmpdir(), 'skydun-extract-'));
    await tar.extract({ file: archive.path, cwd: out });
});

test('an empty folder is refused', async () => {
    await assert.rejects(
        packArchive(await fixture({ '.git/HEAD': '' }), 'html'),
        /nothing to upload/,
    );
});
