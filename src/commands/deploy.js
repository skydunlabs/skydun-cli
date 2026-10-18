import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient, followDeployment } from '../api.js';
import { PROJECT_FILE, readProject } from '../config.js';
import { TYPE_LABELS } from '../detect.js';
import {
    MAX_ARCHIVE_BYTES,
    formatBytes,
    isDirectory,
    packArchive,
} from '../pack.js';
import { requireLogin } from './auth.js';

export const deployHelp = `Usage: skydun deploy [directory] [--site <uuid>] [--message <msg>] [--no-wait]

Upload this folder and deploy it. The panel builds a new release from it
with the website's deploy script and switches it live without downtime.

  Laravel   uploads the source, without vendor, node_modules, .env and
            storage; the server runs composer install, npm run build and
            migrations as the deploy script says.
  Next.js   uploads the source, without node_modules, .next and .env
            files; the server runs npm ci and next build.
  HTML      uploads the publish directory as it is (skydun deploy ./dist),
            or the whole folder to build on the server.

.gitignore and .skydunignore are respected. Archives are limited to
${formatBytes(MAX_ARCHIVE_BYTES)}.

Options:
  --site <uuid>      Deploy this website instead of the one in ${PROJECT_FILE}
  --message <msg>    What the deployment is, shown on the panel
                     (default: the last git commit's subject)
  --no-wait          Return once uploaded instead of following the build`;

/**
 * What the deployment is called on the panel: the last commit's subject,
 * noting uncommitted changes, when the folder is a git repository.
 */
export function gitMessage(cwd) {
    try {
        const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const dirty = execFileSync('git', ['status', '--porcelain'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();

        if (subject === '') {
            return undefined;
        }

        return (
            dirty !== '' ? `${subject} (with uncommitted changes)` : subject
        ).slice(0, 255);
    } catch {
        return undefined;
    }
}

/**
 * Which folder to pack and how: an HTML website's publish directory goes
 * up as it is (prebuilt), anything else is the project's source.
 */
export function resolveUpload(type, cwd, directoryArg, project) {
    const directory = directoryArg ?? project?.directory;

    if (type === 'html' && directory && directory !== '.') {
        return { root: resolve(cwd, directory), prebuilt: true };
    }

    return {
        root: directoryArg ? resolve(cwd, directoryArg) : cwd,
        prebuilt: false,
    };
}

export async function deploy({ args, options, cwd = process.cwd() }) {
    const config = await requireLogin();
    const client = createClient(config);
    const project = await readProject(cwd);
    const siteUuid = options.site || project?.site;

    if (!siteUuid) {
        throw new Error(
            `This folder is not linked to a website. Run skydun link, or pass --site <uuid>.`,
        );
    }

    let type =
        !options.site || options.site === project?.site
            ? project?.type
            : undefined;

    if (!type) {
        const site = (await client.sites()).find(
            (candidate) => candidate.uuid === siteUuid,
        );

        if (!site) {
            throw new Error(
                `No website you may deploy has the uuid ${siteUuid}.`,
            );
        }

        type = site.type;
    }

    const { root, prebuilt } = resolveUpload(type, cwd, args[0], project);

    if (!(await isDirectory(root))) {
        throw new Error(
            `${root} is not a folder.${prebuilt ? ' Build the website first.' : ''}`,
        );
    }

    console.log(
        `Packing ${prebuilt ? root : 'the source'} for a ${TYPE_LABELS[type] ?? type} website…`,
    );
    const archive = await packArchive(root, type, { prebuilt });

    try {
        console.log(
            `Packed ${archive.files} files (${formatBytes(archive.size)}).`,
        );

        if (archive.size > MAX_ARCHIVE_BYTES) {
            throw new Error(
                `The archive is ${formatBytes(archive.size)}, over the ${formatBytes(MAX_ARCHIVE_BYTES)} limit. List large files or folders the build does not need in .skydunignore.`,
            );
        }

        const message = options.message ?? gitMessage(root);
        let phase = 'upload';
        let deploymentUrl = null;

        const onInterrupt = () => {
            process.stdout.write('\n');
            console.log(
                phase === 'upload'
                    ? 'Upload cancelled. Nothing was deployed.'
                    : `Stopped following. The deployment keeps running on the server: ${deploymentUrl}`,
            );
            process.exit(130);
        };
        process.once('SIGINT', onInterrupt);

        const isTty = process.stdout.isTTY;
        const { deployment } = await client.deploy(
            siteUuid,
            archive.path,
            {
                message,
                prebuilt: type === 'html' ? (prebuilt ? '1' : '0') : undefined,
            },
            (sent, total) => {
                if (isTty) {
                    const percent = Math.floor((sent / total) * 100);
                    process.stdout.write(
                        `\rUploading… ${percent}% of ${formatBytes(total)}`,
                    );
                }
            },
        );

        if (isTty) {
            process.stdout.write('\n');
        }

        phase = 'follow';
        deploymentUrl = deployment.url;
        console.log(`Deployment queued: ${deployment.url}`);

        if (options.wait === false) {
            process.removeListener('SIGINT', onInterrupt);

            return 0;
        }

        const finished = await followDeployment(
            client,
            siteUuid,
            deployment.uuid,
            {
                onOutput: (chunk) => process.stdout.write(chunk),
            },
        );

        process.removeListener('SIGINT', onInterrupt);

        if (finished.status === 'succeeded') {
            console.log(`\nDeployed. ${finished.url ?? deployment.url}`);

            return 0;
        }

        console.error(
            `\nThe deployment failed${finished.errorMessage ? `: ${finished.errorMessage}` : '.'}`,
        );
        console.error(finished.url ?? deployment.url);

        return 1;
    } finally {
        await rm(dirname(archive.path), { recursive: true, force: true });
    }
}
