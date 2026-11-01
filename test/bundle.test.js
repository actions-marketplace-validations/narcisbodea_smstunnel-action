import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runAction, sent, startFakeApi } from './support.js';

const BUNDLE = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const KEY = 'sk_live_test_0123456789abcdef0123456789abcd';

describe('the bundle (dist/index.js), run the way the runner runs it', () => {
  let api;
  before(async () => {
    api = await startFakeApi();
  });
  after(() => api.close());
  beforeEach(() => api.reset());

  it('sends one text per number and sets message-ids', async () => {
    let count = 0;
    api.handler = () => sent(`b${(count += 1)}`);

    const result = await runAction(BUNDLE, {
      'api-key': KEY,
      to: '+14155550123\n+14155550124',
      message: 'Release v2.4.0 is out',
      'server-url': api.url,
    });

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.deepEqual(result.outputs, { 'message-ids': 'b1,b2' });
    assert.deepEqual(
      api.requests.map((request) => [request.path, request.headers['x-api-key'], request.body]),
      [
        ['/api/v1/sms/send', KEY, { to: '+14155550123', message: 'Release v2.4.0 is out' }],
        ['/api/v1/sms/send', KEY, { to: '+14155550124', message: 'Release v2.4.0 is out' }],
      ],
    );
    assert.match(api.requests[0].headers['user-agent'], /^smstunnel-action\/1\.0\.0 /);
    assert.ok(result.stdout.includes(`::add-mask::${KEY}`));
    assert.ok(result.stdout.includes('::add-mask::+14155550123'));
    assert.match(result.summary, /<table>/);
    assert.match(result.summary, /…0124/);
    assert.ok(!result.summary.includes('4155550124'));
  });

  it('sends a code through send-2fa', async () => {
    api.handler = () => sent('c1');

    const result = await runAction(BUNDLE, {
      'api-key': KEY,
      to: '+14155550123',
      message: 'Your sign-in code is 482913',
      code: 'true',
      'server-url': api.url,
    });

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(api.requests[0].path, '/api/v1/sms/send-2fa');
  });

  it("fails the step with SMSTunnel's words on a wrong key", async () => {
    api.handler = () => ({ status: 401, body: { message: 'Invalid or expired API key', error: 'Unauthorized', statusCode: 401 } });

    const result = await runAction(BUNDLE, { 'api-key': 'sk_live_wrong', to: '+14155550123', message: 'Hi', 'server-url': api.url });

    assert.equal(result.code, 1);
    assert.match(result.stdout, /::error::No text went to …0123: Invalid or expired API key \(401\)/);
    assert.match(result.stdout, /::error::1 of 1 texts did not go out/);
    assert.deepEqual(result.outputs, { 'message-ids': '' });
  });

  it('fails without an API key and says why it can be empty', async () => {
    const result = await runAction(BUNDLE, { 'api-key': '', to: '+14155550123', message: 'Hi', 'server-url': api.url });

    assert.equal(result.code, 1);
    assert.match(result.stdout, /::error::api-key is empty/);
    assert.equal(api.requests.length, 0);
  });
});
