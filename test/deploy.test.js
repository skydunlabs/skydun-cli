import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { gitMessage } from '../src/commands/deploy.js';
import { fixture } from './helpers.js';

function git(cwd, ...args) {
    execFileSync(
        'git',
        [
            '-c',
            'user.name=Test',
            '-c',
            'user.email=test@example.test',
            '-c',
            'commit.gpgsign=false',
            ...args,
        ],
        { cwd, stdio: 'ignore' },
    );
}

test('the deployment message is the last commit subject, noting uncommitted changes', async () => {
    const root = await fixture({ 'index.html': '' });

    assert.equal(gitMessage(root), undefined);

    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'Add the landing page');
    assert.equal(gitMessage(root), 'Add the landing page');

    await writeFile(join(root, 'index.html'), '<h1>hi</h1>');
    assert.equal(
        gitMessage(root),
        'Add the landing page (with uncommitted changes)',
    );
});
