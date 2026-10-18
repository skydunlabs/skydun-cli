import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Ask a question on the terminal, with a default for an empty answer. */
export function ask(question, fallback = '') {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const suffix = fallback !== '' ? ` (${fallback})` : '';

    return new Promise((resolve) => {
        rl.question(`${question}${suffix}: `, (answer) => {
            rl.close();
            resolve(answer.trim() || fallback);
        });
    });
}

/** Ask for a secret without echoing what is typed. */
export function askHidden(question) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    const write = rl._writeToOutput?.bind(rl);

    return new Promise((resolve) => {
        rl.question(`${question}: `, (answer) => {
            rl.close();
            process.stdout.write('\n');
            resolve(answer.trim());
        });

        if (write) {
            rl._writeToOutput = (text) => {
                if (text.startsWith(question)) {
                    write(text);
                }
            };
        }
    });
}

/** Open a page in the browser, if the system lets us. */
export function openBrowser(url) {
    const [command, args] =
        process.platform === 'darwin'
            ? ['open', [url]]
            : process.platform === 'win32'
              ? ['cmd', ['/c', 'start', '', url]]
              : ['xdg-open', [url]];

    try {
        const child = spawn(command, args, { stdio: 'ignore', detached: true });
        child.on('error', () => {});
        child.unref();
    } catch {
        // No browser here, as on a server: the URL is printed anyway.
    }
}
