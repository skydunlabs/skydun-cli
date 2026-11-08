import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ignore from 'ignore';
import { Pack } from 'tar';

/** The largest archive the panel accepts. */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

/** Never uploaded, whatever the ignore files say. */
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
 * The patterns of a .gitignore in a subfolder, rewritten to apply from
 * the root the way git reads them: a pattern with a slash in it is
 * anchored to that folder, one without matches at any depth below it.
 */
export function nestedPatterns(content, prefix) {
    const folder = prefix.replace(/[[\]*?\\]/g, '\\$&');
    const patterns = [];

    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trimEnd();

        if (line === '' || line.startsWith('#')) {
            continue;
        }

        const negated = line.startsWith('!');
        const pattern = line.slice(negated ? 1 : 0).replace(/^\//, '');

        if (pattern === '') {
            continue;
        }

        const anchored = pattern.slice(0, -1).includes('/');

        patterns.push(
            `${negated ? '!' : ''}${folder}${anchored ? '' : '**/'}${pattern}`,
        );
    }

    return patterns;
}

/** One rule set from the layers, a later layer winning over an earlier. */
function compile(layers) {
    const rules = ignore();

    for (const layer of [...layers.head, ...layers.nested, layers.tail]) {
        rules.add(layer);
    }

    return rules;
}

/**
 * Every path to upload, relative to root with forward slashes, sorted.
 * Symlinks are kept as symlinks and never followed, so nothing outside
 * the project is read.
 *
 * ALWAYS is left out of every upload. A source upload also leaves out the
 * type's own excludes, then what the .gitignore files say (one in a
 * subfolder, nearer the file, wins over the root one), then what
 * .skydunignore says, which may add or (with !) take back paths. A
 * prebuilt folder is uploaded whole.
 */
export async function listFiles(root, type, { prebuilt = false } = {}) {
    const always = ignore().add(ALWAYS);
    const layers = prebuilt
        ? null
        : {
              head: [
                  EXCLUDES[type] ?? EXCLUDES.html,
                  await readIgnoreFile(join(root, '.gitignore')),
              ],
              nested: [],
              tail: await readIgnoreFile(join(root, '.skydunignore')),
          };
    let rules = layers === null ? null : compile(layers);
    const files = [];

    function ignored(path) {
        return always.ignores(path) || (rules !== null && rules.ignores(path));
    }

    async function walk(dir, prefix) {
        const entries = await readdir(dir, { withFileTypes: true });

        if (
            layers !== null &&
            prefix !== '' &&
            entries.some(
                (entry) => entry.name === '.gitignore' && entry.isFile(),
            )
        ) {
            layers.nested.push(
                nestedPatterns(
                    await readIgnoreFile(join(dir, '.gitignore')),
                    prefix,
                ),
            );
            rules = compile(layers);
        }

        for (const entry of entries) {
            const path = `${prefix}${entry.name}`;

            if (entry.isDirectory()) {
                if (!ignored(`${path}/`)) {
                    await walk(join(dir, entry.name), `${path}/`);
                }
            } else if (
                (entry.isFile() || entry.isSymbolicLink()) &&
                !ignored(path)
            ) {
                files.push(path);
            }
        }
    }

    await walk(root, '');

    return files.sort();
}

/**
 * Pack the files into a gzip tarball, in the folder given or a temporary
 * one, with the files at its root. Resolves with its path, size and file
 * count.
 */
export async function packArchive(
    root,
    type,
    { prebuilt = false, folder } = {},
) {
    const files = await listFiles(root, type, { prebuilt });

    if (files.length === 0) {
        throw new Error(`There is nothing to upload in ${root}.`);
    }

    const path = join(
        folder ?? (await mkdtemp(join(tmpdir(), 'skydun-'))),
        'source.tar.gz',
    );

    // Through a Pack of its own rather than tar.create, which reads a
    // listed path that starts with @ as an archive to splice in, so a
    // folder such as @types would break the upload.
    await new Promise((resolve, reject) => {
        const pack = new Pack({
            cwd: root,
            gzip: true,
            portable: true,
            follow: false,
            noDirRecurse: true,
        });
        const out = createWriteStream(path, { mode: 0o600 });

        pack.on('error', (error) => {
            out.destroy();
            reject(error);
        });
        out.on('error', reject);
        out.on('close', resolve);
        pack.pipe(out);

        for (const file of files) {
            pack.add(file);
        }

        pack.end();
    });

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

/** Whether the path is a folder, following a symlink to one. */
export async function isDirectory(path) {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
}
