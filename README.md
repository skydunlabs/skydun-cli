# skydun

Deploy Laravel, Next.js and HTML websites to your skydun panel straight from your machine, without pushing to GitHub first.

```bash
npx skydun deploy
```

The CLI packs your folder, uploads it, and the panel builds a new release from it with the website's deploy script, then switches it live without downtime. The build log streams to your terminal.

## Install

```bash
npm i -g skydun      # then: skydun deploy
npx skydun deploy    # or run it without installing
```

Requires Node.js 20 or newer.

## Getting started

```bash
skydun login         # paste an API token from Settings → API tokens
skydun link          # pick the website this folder deploys to
skydun deploy        # upload and deploy
```

## Commands

| Command                                                                   | What it does                                                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `skydun login [--url <panel>]`                                            | Asks for your panel's address, opens its API tokens page, and saves the token you paste. The token needs the deploy ability. |
| `skydun logout`                                                           | Forgets the saved token. Revoke it on the panel too.                                                                         |
| `skydun whoami`                                                           | Shows who the token logs in as.                                                                                              |
| `skydun link [--site <uuid>]`                                             | Detects whether the folder is Laravel, Next.js or HTML, lists your websites of that kind, and writes `skydun.json`.          |
| `skydun deploy [directory] [--site <uuid>] [--message <msg>] [--no-wait]` | Packs and uploads the folder, then follows the build until it succeeds (exit 0) or fails (exit 1).                           |

`--message` is shown on the panel's deployments page. It defaults to the last git commit's subject, marked "(with uncommitted changes)" when there are some.

Press Ctrl-C while the build log streams to stop following: the deployment keeps running on the server.

## skydun.json

`skydun link` writes it to the project root. Commit it so everyone deploys to the same website.

```json
{
    "site": "9b2f0c1e-…",
    "type": "html",
    "directory": "dist"
}
```

- `site`: the website's uuid.
- `type`: `laravel`, `nextjs` or `html`.
- `directory`: HTML websites only. The ready-built folder to upload, such as `dist`. Leave it out, or set `.`, to upload the source and build on the server.

## What gets uploaded

Each kind of website leaves out what the server builds again and what stays secret on the server. Your `.gitignore` and a `.skydunignore` (same syntax) are applied on top; a `!pattern` in `.skydunignore` takes back a path `.gitignore` leaves out. `.git` is never uploaded.

| Type    | Uploads                                                                      | Leaves out                                                                                                                                                         | On the server                                                                                                                            |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Laravel | The source                                                                   | `vendor`, `node_modules`, `.env` and `.env.*` (keeps `.env.example`), `storage/logs`, `storage/framework`, `bootstrap/cache/*.php`, `public/storage`, `public/hot` | The deploy script runs: `composer install`, `npm run build`, migrations. The website's `.env` and `storage` on the server are linked in. |
| Next.js | The source                                                                   | `node_modules`, `.next`, `.env*` (keeps `.env.example`)                                                                                                            | `npm ci` and `next build`, then the start command.                                                                                       |
| HTML    | The publish directory as it is (`skydun deploy ./dist`), or the whole folder | Nothing from a publish directory; otherwise `node_modules` and `.env*`                                                                                             | A publish directory goes live as it is. A whole folder is built by the deploy script.                                                    |

Private npm and Composer packages install with the credentials set on the panel's Package registries pages, for the workspace or the server.

Archives are limited to 100 MB. If yours is larger, list what the build does not need (videos, fixtures, docs) in `.skydunignore`.

## CI

Set `SKYDUN_URL` and `SKYDUN_TOKEN` instead of logging in. They take the place of the saved login.

```yaml
# GitHub Actions
- run: npm ci && npm run build
- run: npx skydun deploy ./dist
  env:
      SKYDUN_URL: https://panel.example.com
      SKYDUN_TOKEN: ${{ secrets.SKYDUN_TOKEN }}
```

## Where the token is kept

`$XDG_CONFIG_HOME/skydun/config.json`, or `~/.config/skydun/config.json`, readable only by you.

## Development

```bash
git clone git@github.com:skydunlabs/skydun-cli.git
cd skydun-cli
npm ci
npm test
node bin/skydun.js --help
```

The CLI talks to a [skydun](https://github.com/skydunlabs/skydun) panel over its `/api/v1` routes. Against a local Herd panel, run Node with `--use-system-ca` so it trusts Herd's certificate.

Releases are published to npm by the Publish workflow when a GitHub release is created.

## License

MIT. See [LICENSE](LICENSE).
