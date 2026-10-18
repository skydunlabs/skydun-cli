import { createClient } from '../api.js';
import { PROJECT_FILE, writeProject } from '../config.js';
import { TYPE_LABELS, defaultPublishDirectory, detectType } from '../detect.js';
import { ask } from '../prompt.js';
import { requireLogin } from './auth.js';

export const linkHelp = `Usage: skydun link [--site <uuid>]

Link this folder to one of your websites. Writes ${PROJECT_FILE}, which
skydun deploy reads.

Options:
  --site <uuid>  Link this website without asking`;

export async function link({ options, cwd = process.cwd() }) {
    const client = createClient(await requireLogin());
    const sites = await client.sites();

    if (sites.length === 0) {
        throw new Error(
            'You have no websites you may deploy. Create a Laravel, Next.js or HTML website on the panel first.',
        );
    }

    let site;

    if (options.site) {
        site = sites.find((candidate) => candidate.uuid === options.site);

        if (!site) {
            throw new Error(
                `No website you may deploy has the uuid ${options.site}.`,
            );
        }
    } else {
        const detected = detectType(cwd);
        let choices = sites.filter((candidate) => candidate.type === detected);

        console.log(`This looks like a ${TYPE_LABELS[detected]} project.`);

        if (choices.length === 0) {
            console.log(
                `None of your websites is ${TYPE_LABELS[detected]}, so all of them are listed.`,
            );
            choices = sites;
        }

        choices.forEach((candidate, index) => {
            const where = candidate.domain ? ` ${candidate.domain}` : '';
            console.log(
                `  ${index + 1}) ${candidate.name}${where} · ${TYPE_LABELS[candidate.type] ?? candidate.type} · ${candidate.workspace?.name ?? ''}`,
            );
        });

        const answer = Number.parseInt(
            await ask('Website number', choices.length === 1 ? '1' : ''),
            10,
        );
        site = choices[answer - 1];

        if (!site) {
            throw new Error('Pick one of the numbers listed.');
        }
    }

    const project = { site: site.uuid, type: site.type };

    if (site.type === 'html') {
        project.directory = await ask(
            'Publish directory',
            defaultPublishDirectory(cwd),
        );
    }

    await writeProject(project, cwd);
    console.log(
        `Linked to ${site.name}. Run skydun deploy to deploy this folder.`,
    );
}
