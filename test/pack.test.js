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
        'storage/app/.gitignore': '*\n!.gitignore\n',
        'bootstrap/cache/config.php': '',
        'bootstrap/cache/.gitignore': '*\n!.gitignore\n',
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
    // Symlinks need privileges on Windows, so there the archive has none.
    const links = process.platform === 'win32' ? {} : { outside: '/etc' };
    const root = await fixture(
        { 'index.html': '<h1>hi</h1>', 'css/app.css': '' },
        links,
    );
    const archive = await packArchive(root, 'html', { prebuilt: true });
    const entries = [];

    await tar.list({
        file: archive.path,
        onReadEntry: (entry) => entries.push([entry.path, entry.type]),
    });

    const expected = [
        ['css/app.css', 'File'],
        ['index.html', 'File'],
        ...(links.outside ? [['outside', 'SymbolicLink']] : []),
    ];
    assert.equal(archive.files, expected.length);
    assert.deepEqual(entries.sort(), expected);

    const out = await mkdtemp(join(tmpdir(), 'skydun-extract-'));
    await tar.extract({ file: archive.path, cwd: out });
});

test('an empty folder is refused', async () => {
    await assert.rejects(
        packArchive(await fixture({ '.git/HEAD': '' }), 'html'),
        /nothing to upload/,
    );
});

test('a folder whose name starts with @ is packed like any other', async () => {
    const root = await fixture({
        '@shared/util.js': '',
        '@notes.txt': '',
        'index.html': '',
    });
    const archive = await packArchive(root, 'html');
    const entries = [];

    await tar.list({
        file: archive.path,
        onReadEntry: (entry) => entries.push(entry.path),
    });

    assert.deepEqual(entries.sort(), [
        '@notes.txt',
        '@shared/util.js',
        'index.html',
    ]);
});

test('a .gitignore in a subfolder applies from there, as git reads it', async () => {
    const root = await fixture({
        artisan: '',
        'storage/app/.gitignore': '*\n!private/\n!public/\n!.gitignore\n',
        'storage/app/public/.gitignore': '*\n!.gitignore\n',
        'storage/app/public/avatar.png': '',
        'storage/app/private/.gitignore': '*\n!.gitignore\n',
        'storage/app/private/report.pdf': '',
        'storage/app/scratch.txt': '',
        'public/.gitignore': '# built assets\n/build\nhot\n',
        'public/build/app.js': '',
        'public/sub/hot': '',
        'public/index.php': '',
        'resources/build/keep.js': '',
        'resources/hot': '',
    });

    assert.deepEqual(await listFiles(root, 'laravel'), [
        'artisan',
        'public/.gitignore',
        'public/index.php',
        'resources/build/keep.js',
        'resources/hot',
        'storage/app/.gitignore',
        'storage/app/private/.gitignore',
        'storage/app/public/.gitignore',
    ]);
});

test('.skydunignore can take back a path a nested .gitignore leaves out', async () => {
    const root = await fixture({
        'index.html': '',
        'uploads/.gitignore': '*\n!.gitignore\n',
        'uploads/seed.png': '',
        'uploads/tmp.png': '',
        '.skydunignore': '!uploads/seed.png\n',
    });

    assert.deepEqual(await listFiles(root, 'html'), [
        'index.html',
        'uploads/.gitignore',
        'uploads/seed.png',
    ]);
});
