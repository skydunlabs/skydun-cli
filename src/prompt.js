import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Put a question to a readline interface. Rejects when the input closes
 * before an answer comes, as it does in CI with nothing piped in, rather
 * than leaving the command waiting for one that never arrives.
 */
function question(rl, prompt, label) {
    return new Promise((resolve, reject) => {
        let answered = false;

        rl.question(prompt, (answer) => {
            answered = true;
            rl.close();
            resolve(answer);
        });

        rl.on('close', () => {
            if (!answered) {
                reject(
                    new Error(
                        `No answer to "${label}": the input closed. Run this in a terminal, or pass the value as an option.`,
                    ),
                );
            }
        });
    });
}

/** Ask a question on the terminal, with a default for an empty answer. */
export async function ask(
    label,
    fallback = '',
    { input = process.stdin, output = process.stdout } = {},
) {
    const suffix = fallback !== '' ? ` (${fallback})` : '';
    const rl = createInterface({ input, output });
    const answer = await question(rl, `${label}${suffix}: `, label);

    return answer.trim() || fallback;
}

/**
 * Ask for a secret without echoing it. Readline draws what is typed, and
 * redraws the whole line, prompt first, on backspace and cursor keys; so
 * only the prompt is ever let through to the output, never the secret.
 */
export async function askHidden(
    label,
    {
        input = process.stdin,
        output = process.stdout,
        terminal = Boolean(input.isTTY),
    } = {},
) {
    const prompt = `${label}: `;
    const rl = createInterface({ input, output, terminal });

    if (terminal && typeof rl._writeToOutput === 'function') {
        const write = rl._writeToOutput.bind(rl);

        rl._writeToOutput = (text) => {
            if (text.startsWith(prompt)) {
                write(prompt);
            }
        };
    }

    const answer = await question(rl, prompt, label);
    output.write('\n');

    return answer.trim();
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
