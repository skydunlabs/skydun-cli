import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
    configPath,
    loadConfig,
    normalizeUrl,
    saveConfig,
} from '../src/config.js';

async function env(extra = {}) {
    return {
        XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'skydun-config-')),
        ...extra,
    };
}

test('the saved login is private to the user and read back', async () => {
    const vars = await env();
    await saveConfig({ url: 'https://panel.test', token: 'saved' }, vars);

    assert.equal(
        configPath(vars),
        join(vars.XDG_CONFIG_HOME, 'skydun', 'config.json'),
    );
    assert.equal((await stat(configPath(vars))).mode & 0o777, 0o600);
    assert.deepEqual(await loadConfig(vars), {
        url: 'https://panel.test',
        token: 'saved',
    });
});

test('SKYDUN_URL and SKYDUN_TOKEN win over the saved login', async () => {
    const vars = await env();
    await saveConfig({ url: 'https://panel.test', token: 'saved' }, vars);

    assert.deepEqual(await loadConfig({ ...vars, SKYDUN_TOKEN: 'from-ci' }), {
        url: 'https://panel.test',
        token: 'from-ci',
    });
    assert.deepEqual(
        await loadConfig({
            ...vars,
            SKYDUN_URL: 'ci.panel.test/',
            SKYDUN_TOKEN: 'x',
        }),
        { url: 'https://ci.panel.test', token: 'x' },
    );
});

test('no login gives empty values', async () => {
    assert.deepEqual(await loadConfig(await env()), { url: '', token: '' });
});

test('panel addresses get a scheme and lose trailing slashes', () => {
    assert.equal(normalizeUrl(' panel.test// '), 'https://panel.test');
    assert.equal(
        normalizeUrl('http://localhost:8000/'),
        'http://localhost:8000',
    );
});
