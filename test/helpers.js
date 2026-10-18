import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A temporary folder with the given files, keyed by relative path. */
export async function fixture(files, links = {}) {
    const root = await mkdtemp(join(tmpdir(), 'skydun-test-'));

    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
    }

    for (const [path, target] of Object.entries(links)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await symlink(target, join(root, path));
    }

    return root;
}
