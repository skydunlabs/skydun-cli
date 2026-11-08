import { createClient } from '../api.js';
import {
    clearConfig,
    loadConfig,
    normalizeUrl,
    readSavedConfig,
    saveConfig,
} from '../config.js';
import { ask, askHidden, openBrowser } from '../prompt.js';

export const loginHelp = `Usage: skydun login [--url <panel>]

Log in to your skydun panel with an API token. The token page opens in your
browser: create a token there and paste it here.

Options:
  --url <panel>  The panel's address, such as https://panel.example.com`;

export async function login({ options }) {
    // A saved login that cannot be read is replaced by this one.
    const saved = await readSavedConfig().catch(() => ({}));
    const url = normalizeUrl(
        options.url || (await ask('Panel URL', saved.url ?? '')),
    );

    if (url === '') {
        throw new Error('Enter the address of your skydun panel.');
    }

    const tokensPage = `${url}/settings/api-tokens`;
    console.log(`Create a token with the deploy ability at ${tokensPage}`);
    openBrowser(tokensPage);

    const token = await askHidden('API token');

    if (token === '') {
        throw new Error('Paste the token to log in.');
    }

    const user = await createClient({ url, token }).user();
    const path = await saveConfig({ url, token });

    console.log(`Logged in as ${user.name} (${user.email}). Saved to ${path}.`);
}

export const logoutHelp = `Usage: skydun logout

Forget the saved token. Revoke it on the panel's API tokens page too.`;

export async function logout() {
    await clearConfig();
    console.log(
        'Logged out. Revoke the token on the panel if you no longer need it.',
    );
}

export const whoamiHelp = `Usage: skydun whoami

Show who the saved token (or SKYDUN_TOKEN) logs in as.`;

export async function whoami() {
    const config = await requireLogin();
    const user = await createClient(config).user();

    console.log(`${user.name} (${user.email}) on ${config.url}`);
}

export async function requireLogin() {
    const config = await loadConfig();

    if (!config.url || !config.token) {
        throw new Error(
            'You are not logged in. Run skydun login, or set SKYDUN_URL and SKYDUN_TOKEN.',
        );
    }

    return config;
}
