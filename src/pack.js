import { readFile, readdir, lstat, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import ignore from 'ignore';
import * as tar from 'tar';

/** The largest archive the panel accepts. */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

const ALWAYS = ['.git', 'skydun.json', '.skydunignore', '.DS_Store'];

/**
 * What each kind of website leaves out on top of .gitignore and
 * .skydunignore: dependencies and builds the server makes again, and
 * secrets that stay on the server.
 */
const EXCLUDES = {
    laravel: [
        'vendor/',
        'node_modules/',
        '.env',
        '.env.*',
        '!.env.example',
        'storage/logs/',
        'storage/framework/',
        'bootstrap/cache/*.php',
        'public/storage',
        'public/hot',
    ],
    nextjs: ['node_modules/', '.next/', '.env*', '!.env.example'],
    html: ['node_modules/', '.env*', '!.env.example'],
};

async function readIgnoreFile(path) {
    try {
        return await readFile(path, 'utf8');
    } catch {
        return '';
    }
}

/**
 * The rules for a folder: the type's own, then the project's .gitignore
 * and .skydunignore, which may add or (with !) take back paths. A
 * prebuilt folder is uploaded whole, except .git.
 */
export async function ignoreRules(root, type, { prebuilt = false } = {}) {
    const rules = ignore().add(ALWAYS);

    if (prebuilt) {
        return rules;
    }

    rules.add(EXCLUDES[type] ?? EXCLUDES.html);
    rules.add(await readIgnoreFile(join(root, '.gitignore')));
    rules.add(await readIgnoreFile(join(root, '.skydunignore')));

    return rules;
}

/**
 * Every path to upload, relative to root with forward slashes, sorted.
 * Symlinks are kept as symlinks and never followed, so nothing outside
 * the project is read.
 */
export async function listFiles(root, type, options = {}) {
    const rules = await ignoreRules(root, type, options);
    const files = [];

    async function walk(dir) {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const absolute = join(dir, entry.name);
            const path = relative(root, absolute).split(sep).join('/');

            if (entry.isDirectory()) {
                if (rules.ignores(`${path}/`)) {
                    continue;
                }

                await walk(absolute);
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                if (!rules.ignores(path)) {
                    files.push(path);
                }
            }
        }
    }

    await walk(root);

    return files.sort();
}

/**
 * Pack the files into a gzip tarball in a temporary folder, with the files
 * at its root. Resolves with its path, size and file count.
 */
export async function packArchive(root, type, options = {}) {
    const files = await listFiles(root, type, options);

    if (files.length === 0) {
        throw new Error(`There is nothing to upload in ${root}.`);
    }

    const folder = await mkdtemp(join(tmpdir(), 'skydun-'));
    const path = join(folder, 'source.tar.gz');

    await tar.create(
        {
            gzip: true,
            file: path,
            cwd: root,
            portable: true,
            follow: false,
            noDirRecurse: true,
        },
        files,
    );

    return { path, size: (await stat(path)).size, files: files.length };
}

export function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }

    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export async function isDirectory(path) {
    try {
        return (await lstat(path)).isDirectory();
    } catch {
        return false;
    }
}
