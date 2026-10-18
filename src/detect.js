import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TYPES = ['laravel', 'nextjs', 'html'];

export const TYPE_LABELS = {
    laravel: 'Laravel',
    nextjs: 'Next.js',
    html: 'HTML',
};

/**
 * What kind of website the folder holds: Laravel when it has an artisan
 * file, Next.js when it has a next.config or depends on next, HTML
 * otherwise.
 */
export function detectType(cwd) {
    if (existsSync(join(cwd, 'artisan'))) {
        return 'laravel';
    }

    if (
        ['js', 'mjs', 'cjs', 'ts', 'mts'].some((ext) =>
            existsSync(join(cwd, `next.config.${ext}`)),
        )
    ) {
        return 'nextjs';
    }

    try {
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));

        if (pkg.dependencies?.next || pkg.devDependencies?.next) {
            return 'nextjs';
        }
    } catch {
        // No package.json, or not JSON.
    }

    return 'html';
}

/** The publish directory link suggests for an HTML website. */
export function defaultPublishDirectory(cwd) {
    return existsSync(join(cwd, 'dist')) ? 'dist' : '.';
}
