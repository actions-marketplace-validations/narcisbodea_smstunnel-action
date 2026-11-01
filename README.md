# SMSTunnel SMS for GitHub Actions

`narcisbodea/smstunnel-action`: send a text from your workflows through **your own Android phone**, from **your own number**, with **[SMSTunnel](https://smstunnel.io)**. Get a text when a deployment fails, when a release goes out, or when a nightly job needs you.

The workflow hands the text to your SMSTunnel account and your phone sends it from its own SIM, so you get it from a number you know, even where there is no internet. The phone is linked to your account when you sign in to the SMSTunnel app, and you can cut the workflow off at any time by deleting its API key in your dashboard.

Your phone needs the SMSTunnel app from Google Play:

<a href="https://play.google.com/store/apps/details?id=io.smstunnel.app"><img src="https://smstunnel.io/google-play-badge.png" alt="Get it on Google Play" height="56"></a>

This action is made by NARBOWEB SRL. It is not affiliated with, endorsed by, or sponsored by GitHub.

## Quick start

```yaml
- name: Text me
  uses: narcisbodea/smstunnel-action@v1
  with:
    api-key: ${{ secrets.SMSTUNNEL_API_KEY }}
    to: ${{ secrets.ALERT_PHONE }}
    message: "${{ github.repository }}: the deployment failed. ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

## Setup

1. Install the [SMSTunnel app from Google Play](https://play.google.com/store/apps/details?id=io.smstunnel.app) on your Android phone and sign in. Sign in at [smstunnel.io](https://smstunnel.io) on your computer with the same account: the phone appears under **Phones** (you can also link it with the QR code from **Phones → Add phone**).
2. In your [SMSTunnel dashboard](https://dashboard.smstunnel.io/apps), open **Apps** → **Add an app** and create its key.
3. In your repository, open **Settings → Secrets and variables → Actions → New repository secret** and save the key as `SMSTUNNEL_API_KEY`.
4. In a public repository, save the number too (`ALERT_PHONE` in the examples): workflow files and logs are public. The action never prints the numbers it texts, and hides the key and the numbers if anything else prints them.

## Inputs

| Input | Required | Description |
| --- | --- | --- |
| `api-key` | yes | Your SMSTunnel API key. Pass it from a secret. |
| `to` | yes | The number in international format (`+14155550123`). Several numbers, separated by commas or new lines, get one text each (at most 30). |
| `message` | yes | The text, up to 1600 characters. |
| `device-id` | no | Send through this phone (its ID is under **Phones** in the dashboard). Empty: SMSTunnel picks one of yours. |
| `default-country-code` | no | For example `+40`: completes numbers written without `+` or `00`. |
| `code` | no | `true` sends a sign-in code to one number: the text must contain the code, 4 to 10 digits standing on their own (`482913`), up to 320 characters. Codes count against a separate quota. Default `false`. |
| `server-url` | no | Only for a self-hosted SMSTunnel or a test server. Default `https://smstunnel.io`. |

## Outputs

| Output | Description |
| --- | --- |
| `message-ids` | The IDs of the texts, comma-separated, in the order of the numbers (empty for a number that got no text). |

The step also writes a table to the job summary: the last digits of each number, the message ID, and what happened.

## Examples

### Text me when a deployment fails

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: ./deploy.sh

      - name: Text me if it failed
        if: failure()
        uses: narcisbodea/smstunnel-action@v1
        with:
          api-key: ${{ secrets.SMSTUNNEL_API_KEY }}
          to: ${{ secrets.ALERT_PHONE }}
          message: "Deploy of ${{ github.repository }} failed at ${{ github.sha }}: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

### Tell the team about a release

```yaml
name: Release texts
on:
  release:
    types: [published]

jobs:
  text:
    runs-on: ubuntu-latest
    steps:
      - uses: narcisbodea/smstunnel-action@v1
        with:
          api-key: ${{ secrets.SMSTUNNEL_API_KEY }}
          to: ${{ secrets.TEAM_PHONES }} # "+14155550123, +14155550124": one text each
          message: "${{ github.event.repository.name }} ${{ github.event.release.tag_name }} is out: ${{ github.event.release.html_url }}"
```

### Use the message IDs

```yaml
      - id: sms
        uses: narcisbodea/smstunnel-action@v1
        with:
          api-key: ${{ secrets.SMSTUNNEL_API_KEY }}
          to: ${{ secrets.ALERT_PHONE }}
          message: The nightly backup finished.
      - name: Show the IDs
        env:
          IDS: ${{ steps.sms.outputs.message-ids }}
        run: echo "SMSTunnel message IDs: $IDS"
```

## Pull requests from forks, and Dependabot

GitHub gives no secrets to workflows that run for pull requests from forks, or for Dependabot. There `api-key` is empty, and the step fails with a message that says so. Skip the step in those runs:

```yaml
        if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
```

Don't switch to `pull_request_target` to get the secret into a fork's workflow: that runs with your secrets next to code from a stranger's pull request.

## When a text does not go out

The step fails, with SMSTunnel's own explanation for each number:

| Status | Meaning |
| --- | --- |
| 401 | The API key is wrong, was deleted, or its account is suspended. The other numbers aren't tried. |
| 403 | The key may not do this (`PERMISSION_REQUIRED`), or the plan does not include it. The other numbers aren't tried. |
| 429 | Too many requests: the step waits as long as SMSTunnel asks (up to a minute) and tries once more. |
| 400 | SMSTunnel refused a field: a number it cannot read, a code text without a code. The other numbers still get their text. |

A failed text should not fail your deployment? Add `continue-on-error: true` to the step. If your phone is offline, the text is not lost: it waits on your account and goes out when the phone is back (the summary says *queued*).

## Notes and limits

- **Rate limit**: SMSTunnel allows 30 sends a minute; the action sends one text at a time.
- **Length**: up to 1600 characters (10 joined SMS); codes up to 320.
- **Numbers**: use the international format (`+14155550123`). For local numbers, set `default-country-code`: it always takes precedence over the phone's.
- **Runtime**: the action runs on Node.js 24 (`node24`), on GitHub-hosted and self-hosted runners.
- **Pinning**: `@v1` follows the 1.x releases; for a fixed version, use a full commit SHA instead.

## Build it with an AI assistant

Paste this into Claude, ChatGPT, Cursor or Copilot, and replace the part in brackets. Never paste your real API key into a prompt.

```text
Write a GitHub Actions workflow step that sends a text with SMSTunnel. SMSTunnel sends each text from my own Android phone, from my own number: the phone runs the SMSTunnel app and is linked to my SMSTunnel account.

Use the action narcisbodea/smstunnel-action@v1 with these inputs:
- api-key: ${{ secrets.SMSTUNNEL_API_KEY }} (required)
- to: the number in international format (+14155550123); several numbers separated by commas or new lines get one text each, at most 30
- message: the text, up to 1600 characters
- device-id (optional): the phone to send from; default-country-code (optional, e.g. "+40"): completes numbers written without + or 00
- code: "true" only for sign-in codes, to one number: the text must contain a code of 4 to 10 digits standing on its own (e.g. 482913 or 123-456), at most 320 characters
Output: message-ids (comma-separated). Behind it is POST https://smstunnel.io/api/v1/sms/send with the header X-API-Key, one recipient per call, 30 send requests a minute. The step fails on 401 (bad key), 403 (missing permission or plan; code such as PERMISSION_REQUIRED), 400 (refused number or text) and 5xx; on 429 it waits and retries once. If the phone is offline, the text waits on the account and goes out when the phone is back.

What I want: [describe what should send a text, to whom, and when]

Rules:
- Keep the API key in a repository secret, never in the workflow file, the repository or client-side code. In a public repository, keep the phone numbers in secrets too.
- Skip the step for pull requests from forks and for Dependabot (they get no secrets); never use pull_request_target for this.
- Validate numbers (international format) and decide whether a failed text should fail the job (continue-on-error).
- Only send texts people expect (alerts to myself, release notes to my team, sign-in codes).
```

## Responsible use

Send only texts that people expect from you: alerts to yourself, notes to your team, sign-in codes. Unsolicited messages from a personal SIM break most carriers' terms of service. Please make sure your usage complies with your carrier's terms and with local regulations (in the EU, that includes GDPR and ePrivacy rules on electronic communications).

## Development

```bash
npm ci
npm test            # unit tests with a mocked client, and the bundle run like the runner runs it
npm run build       # bundles src/ into dist/ with @vercel/ncc; commit dist/
```

The end-to-end tests run the bundled action against a test server, never production. They read `{ "serverUrl", "apiKey", "deviceId" }` from a JSON file and, with `SMSTUNNEL_E2E_MONGO_URL`, check each text in the server's database:

```bash
SMSTUNNEL_E2E_KEY_FILE=/path/to/test-key.json npm run test:e2e
```

## License

MIT, © NARBOWEB SRL. See [LICENSE](LICENSE).
