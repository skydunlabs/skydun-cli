import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const PROJECT_FILE = 'skydun.json';

/**
 * Where the login is kept: $XDG_CONFIG_HOME/skydun/config.json, or
 * ~/.config/skydun/config.json.
 */
export function configPath(env = process.env) {
    const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');

    return join(base, 'skydun', 'config.json');
}

async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }

        throw new Error(`${path} is not valid JSON: ${error.message}`);
    }
}

/** The saved login, as written to the config file. */
export async function readSavedConfig(env = process.env) {
    return (await readJson(configPath(env))) ?? {};
}

/**
 * The login to use: SKYDUN_URL and SKYDUN_TOKEN win over the saved
 * config, so CI needs no file.
 */
export async function loadConfig(env = process.env) {
    const saved = await readSavedConfig(env);

    return {
        url: normalizeUrl(env.SKYDUN_URL || saved.url || ''),
        token: env.SKYDUN_TOKEN || saved.token || '',
    };
}

export async function saveConfig(config, env = process.env) {
    const path = configPath(env);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(config, null, 2) + '\n', {
        mode: 0o600,
    });
    await chmod(path, 0o600);

    return path;
}

export async function clearConfig(env = process.env) {
    await rm(configPath(env), { force: true });
}

export function normalizeUrl(url) {
    let value = String(url).trim().replace(/\/+$/, '');

    if (value !== '' && !/^https?:\/\//i.test(value)) {
        value = `https://${value}`;
    }

    return value;
}

export async function readProject(cwd = process.cwd()) {
    return readJson(join(cwd, PROJECT_FILE));
}

export async function writeProject(project, cwd = process.cwd()) {
    const path = join(cwd, PROJECT_FILE);
    await writeFile(path, JSON.stringify(project, null, 2) + '\n');

    return path;
}
