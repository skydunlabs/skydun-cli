import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import { ask, askHidden } from '../src/prompt.js';

/** A fake terminal: a stream to type into and what was written to it. */
function terminal() {
    const input = new PassThrough();
    let written = '';
    const output = new Writable({
        write(chunk, _encoding, callback) {
            written += chunk.toString();
            callback();
        },
    });
    output.columns = 80;

    return { input, output, written: () => written };
}

test('a hidden answer never reaches the terminal, not even when edited', async () => {
    const tty = terminal();
    const answer = askHidden('API token', {
        input: tty.input,
        output: tty.output,
        terminal: true,
    });

    tty.input.write('secret123');
    // Backspace makes readline redraw the whole line, prompt and all.
    tty.input.write('\u007f');
    tty.input.write('4\r');

    assert.equal(await answer, 'secret124');
    assert.ok(tty.written().includes('API token: '));
    assert.ok(!tty.written().includes('secret'));
});

test('an empty answer takes the fallback', async () => {
    const tty = terminal();
    const answer = ask('Publish directory', 'dist', {
        input: tty.input,
        output: tty.output,
    });
    tty.input.write('\n');

    assert.equal(await answer, 'dist');
});

test('a question with no one there to answer is refused rather than waited on', async () => {
    const tty = terminal();
    const answer = ask('Website number', '', {
        input: tty.input,
        output: tty.output,
    });
    tty.input.end();

    await assert.rejects(answer, /No answer to "Website number"/);
});
