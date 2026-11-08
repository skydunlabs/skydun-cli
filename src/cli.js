import { readFileSync } from 'node:fs';
import { friendlyMessage } from './api.js';
import {
    login,
    loginHelp,
    logout,
    logoutHelp,
    whoami,
    whoamiHelp,
} from './commands/auth.js';
import { deploy, deployHelp } from './commands/deploy.js';
import { link, linkHelp } from './commands/link.js';

const COMMANDS = {
    login: {
        run: login,
        help: loginHelp,
        summary: 'Log in to your panel with an API token',
    },
    logout: {
        run: logout,
        help: logoutHelp,
        summary: 'Forget the saved token',
    },
    whoami: {
        run: whoami,
        help: whoamiHelp,
        summary: 'Show who you are logged in as',
    },
    link: {
        run: link,
        help: linkHelp,
        summary: 'Link this folder to a website',
    },
    deploy: {
        run: deploy,
        help: deployHelp,
        summary: 'Upload this folder and deploy it',
    },
};

const VALUE_OPTIONS = new Set(['url', 'site', 'message']);
const FLAG_OPTIONS = new Set(['help', 'version', 'wait']);

export function version() {
    const pkg = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );

    return pkg.version;
}

function mainHelp() {
    const rows = Object.entries(COMMANDS)
        .map(([name, command]) => `  ${name.padEnd(8)} ${command.summary}`)
        .join('\n');

    return `skydun ${version()}: deploy Laravel, Next.js and HTML websites from your machine.

Usage: skydun <command> [options]

Commands:
${rows}

Run skydun <command> --help for a command's options.
In CI, set SKYDUN_URL and SKYDUN_TOKEN instead of logging in.`;
}

/**
 * Split argv into the command, its positional arguments and its options:
 * --name value, --name=value, --flag and --no-flag. An option no command
 * has is refused, so a typo does not pass unnoticed.
 */
export function parseArgs(argv) {
    const args = [];
    const options = {};
    let command = null;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '-h') {
            options.help = true;
        } else if (arg === '-v') {
            options.version = true;
        } else if (arg.startsWith('--')) {
            const [rawName, inline] = arg.slice(2).split(/=(.*)/s, 2);
            const negated = rawName.startsWith('no-');
            const name = negated ? rawName.slice(3) : rawName;

            if (!negated && VALUE_OPTIONS.has(name)) {
                const value = inline ?? argv[++i];

                if (value === undefined || value.startsWith('--')) {
                    throw new Error(`--${name} needs a value.`);
                }

                options[name] = value;
            } else if (FLAG_OPTIONS.has(name)) {
                options[name] = !negated;
            } else {
                throw new Error(
                    `Unknown option --${rawName}. Run skydun --help to see the options.`,
                );
            }
        } else if (arg.startsWith('-') && arg !== '-') {
            throw new Error(
                `Unknown option ${arg}. Options are spelled out, as in --site.`,
            );
        } else if (command === null) {
            command = arg;
        } else {
            args.push(arg);
        }
    }

    return { command, args, options };
}

/**
 * Run the CLI with the given arguments and resolve with its exit code.
 * The context, such as cwd, reaches the command alongside its arguments.
 */
export async function main(argv, context = {}) {
    let parsed;

    try {
        parsed = parseArgs(argv);
    } catch (error) {
        console.error(error.message);

        return 2;
    }

    const { command, args, options } = parsed;

    if (options.version && command === null) {
        console.log(version());

        return 0;
    }

    if (command === null || command === 'help') {
        console.log(COMMANDS[args[0]]?.help ?? mainHelp());

        return 0;
    }

    const entry = COMMANDS[command];

    if (!entry) {
        console.error(`Unknown command: ${command}\n\n${mainHelp()}`);

        return 2;
    }

    if (options.help) {
        console.log(entry.help);

        return 0;
    }

    try {
        return (await entry.run({ args, options, ...context })) ?? 0;
    } catch (error) {
        console.error(friendlyMessage(error));

        return 1;
    }
}
