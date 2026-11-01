import * as actionsCore from '@actions/core';

import { SmsTunnelError, createClient, normalizeServerUrl } from './client.js';
import { MAX_RECIPIENTS, maskNumber, parseRecipients } from './recipients.js';

export const VERSION = '1.0.0';
const USER_AGENT = `smstunnel-action/${VERSION} Node.js/${process.versions.node}`;
/** The longest a 429 is waited out before the one retry. */
const MAX_RETRY_AFTER_S = 60;

const NO_KEY =
  'api-key is empty. Add your SMSTunnel API key as a repository secret named SMSTUNNEL_API_KEY and pass it with ' +
  '`api-key: ${{ secrets.SMSTUNNEL_API_KEY }}`. GitHub gives no secrets to workflows that run for pull requests ' +
  'from forks, or for Dependabot: skip this step there.';

const sleepFor = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** "Invalid or expired API key (401)": SMSTunnel's words and the status. */
function explain(error) {
  if (!(error instanceof SmsTunnelError) || !error.status) return error.message || String(error);
  return `${error.message} (${error.status}${error.code ? ` ${error.code}` : ''})`;
}

function readBoolean(core, name) {
  const value = core.getInput(name).toLowerCase();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be true or false (got "${core.getInput(name)}").`);
}

/**
 * Sends the text to every number in `to`, one text each, and sets the `message-ids` output.
 *
 * @param {{core?: typeof actionsCore, createClient?: typeof createClient, sleep?: (seconds: number) => Promise<void>}} [dependencies]
 *   replaced in the unit tests
 */
export async function run(dependencies = {}) {
  const core = dependencies.core ?? actionsCore;
  const makeClient = dependencies.createClient ?? createClient;
  const sleep = dependencies.sleep ?? sleepFor;

  try {
    const apiKey = core.getInput('api-key');
    if (!apiKey) throw new Error(NO_KEY);
    core.setSecret(apiKey);

    const numbers = parseRecipients(core.getInput('to'));
    if (numbers.length === 0) throw new Error('to is empty: give the number to text, such as +14155550123.');
    // Workflow logs of public repositories are public: the numbers never appear in them. (Something too short to
    // be a number would hide digits all over the log, and SMSTunnel refuses it anyway.)
    for (const number of numbers) if (number.replace(/\D/g, '').length >= 7) core.setSecret(number);

    const message = core.getInput('message', { trimWhitespace: false });
    if (!message.trim()) throw new Error('message is empty.');

    const code = readBoolean(core, 'code');
    if (code && numbers.length > 1) throw new Error('With code: true, to must be one number: a sign-in code goes to one person.');
    if (numbers.length > MAX_RECIPIENTS) {
      throw new Error(`to has ${numbers.length} numbers; at most ${MAX_RECIPIENTS} (SMSTunnel sends up to 30 texts a minute).`);
    }

    const extra = {
      deviceId: core.getInput('device-id'),
      defaultCountryCode: core.getInput('default-country-code'),
    };
    const client = makeClient({
      apiKey,
      serverUrl: normalizeServerUrl(core.getInput('server-url')),
      userAgent: USER_AGENT,
    });

    const send = async (number) => {
      const call = () =>
        code ? client.sendVerificationCode(number, message, extra) : client.sendSms(number, message, extra);
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof SmsTunnelError) || error.status !== 429) throw error;
        const seconds = Math.min(MAX_RETRY_AFTER_S, Math.max(1, error.retryAfter ?? 15));
        core.info(`SMSTunnel asks to slow down: waiting ${seconds} s, then trying once more.`);
        await sleep(seconds);
        return call();
      }
    };

    const rows = [];
    const ids = [];
    let failed = 0;
    for (const [index, number] of numbers.entries()) {
      const who = maskNumber(number);
      try {
        const answer = await send(number);
        const messageId = answer.messageId || answer.data?.messageId || '';
        const queued = Boolean(answer.queued ?? answer.data?.queued);
        ids.push(messageId);
        rows.push([who, messageId, queued ? 'queued: the phone is offline, it sends the text when it is back' : 'handed to the phone']);
        core.info(`${code ? 'Code' : 'Text'} to ${who}: ${messageId}${queued ? ' (queued: the phone is offline)' : ''}`);
      } catch (error) {
        failed += 1;
        ids.push('');
        rows.push([who, '—', `not sent: ${explain(error)}`]);
        core.error(`No ${code ? 'code' : 'text'} went to ${who}: ${explain(error)}`);
        // A wrong key or a missing permission would refuse every other number too.
        if (error instanceof SmsTunnelError && (error.status === 401 || error.status === 403)) {
          for (const rest of numbers.slice(index + 1)) {
            failed += 1;
            ids.push('');
            rows.push([maskNumber(rest), '—', 'not tried']);
          }
          break;
        }
      }
    }

    core.setOutput('message-ids', ids.join(','));
    await writeSummary(core, rows);
    if (failed > 0) core.setFailed(`${failed} of ${numbers.length} texts did not go out.`);
  } catch (error) {
    core.setFailed(explain(error));
  }
}

/** A table in the job's summary page (masked numbers only). Outside GitHub there may be no summary to write to. */
async function writeSummary(core, rows) {
  try {
    await core.summary
      .addHeading('SMSTunnel', 3)
      .addTable([
        [
          { data: 'To', header: true },
          { data: 'Message ID', header: true },
          { data: 'Result', header: true },
        ],
        ...rows,
      ])
      .write();
  } catch (error) {
    core.debug(`No job summary: ${error.message}`);
  }
}
