import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { SmsTunnelError, createClient, normalizeServerUrl } from '../src/client.js';
import { MAX_RECIPIENTS, maskNumber, parseRecipients } from '../src/recipients.js';
import { sent, startFakeApi } from './support.js';

const KEY = 'sk_live_test_0123456789abcdef0123456789abcd';

describe('recipients', () => {
  it('splits on commas, semicolons and new lines, and drops repeats', () => {
    assert.deepEqual(parseRecipients('+14155550123, +14155550124;+14155550125\n+14155550123\r\n'), [
      '+14155550123',
      '+14155550124',
      '+14155550125',
    ]);
  });

  it('keeps the spaces inside a number, and gives nothing for an empty input', () => {
    assert.deepEqual(parseRecipients('+40 712 345 678'), ['+40 712 345 678']);
    assert.deepEqual(parseRecipients(''), []);
    assert.deepEqual(parseRecipients(undefined), []);
  });

  it('masks a number down to its last four digits', () => {
    assert.equal(maskNumber('+14155550123'), '…0123');
    assert.equal(maskNumber('123'), '…');
    assert.equal(MAX_RECIPIENTS, 30);
  });
});

describe('client', () => {
  let api;
  before(async () => {
    api = await startFakeApi();
  });
  after(() => api.close());
  beforeEach(() => api.reset());

  it('sends one text with the key, the optional fields, and no redirects', async () => {
    api.handler = () => sent('m1');
    const client = createClient({ apiKey: ` ${KEY} `, serverUrl: `${api.url}/`, userAgent: 'test/1' });

    const answer = await client.sendSms(' +14155550123 ', 'Deploy failed', { deviceId: 'd1', defaultCountryCode: '+1' });

    assert.equal(answer.messageId, 'm1');
    const [request] = api.requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.path, '/api/v1/sms/send');
    assert.equal(request.headers['x-api-key'], KEY);
    assert.equal(request.headers['user-agent'], 'test/1');
    assert.deepEqual(request.body, { to: '+14155550123', message: 'Deploy failed', deviceId: 'd1', defaultCountryCode: '+1' });
  });

  it('sends codes to send-2fa and leaves out empty fields', async () => {
    api.handler = () => sent('c1');
    const client = createClient({ apiKey: KEY, serverUrl: api.url });

    await client.sendVerificationCode('+14155550123', 'Code 482913', { deviceId: '', defaultCountryCode: '' });

    assert.equal(api.requests[0].path, '/api/v1/sms/send-2fa');
    assert.deepEqual(api.requests[0].body, { to: '+14155550123', message: 'Code 482913' });
  });

  it('turns an error answer into an SmsTunnelError', async () => {
    const client = createClient({ apiKey: KEY, serverUrl: api.url });
    api.handler = () => ({ status: 403, body: { message: 'Upgrade needed', code: 'PLAN_REQUIRED', statusCode: 403 } });
    await assert.rejects(client.sendSms('+1', 'x'), (error) => {
      assert.ok(error instanceof SmsTunnelError);
      assert.equal(error.status, 403);
      assert.equal(error.code, 'PLAN_REQUIRED');
      assert.equal(error.message, 'Upgrade needed');
      return true;
    });
    api.handler = () => ({ status: 429, body: { message: 'Too Many Requests' }, headers: { 'Retry-After': '9' } });
    await assert.rejects(client.sendSms('+1', 'x'), { status: 429, retryAfter: 9 });
    api.handler = () => ({ status: 400, body: { message: ['to is wrong', 'message is empty'] } });
    await assert.rejects(client.sendSms('+1', 'x'), { message: 'to is wrong; message is empty' });
    api.handler = () => ({ status: 503, body: '<h1>Service Unavailable</h1>' });
    await assert.rejects(client.sendSms('+1', 'x'), { message: 'Service Unavailable', status: 503 });
    api.handler = () => ({ status: 200, body: { success: false, error: 'Device offline' } });
    await assert.rejects(client.sendSms('+1', 'x'), { message: 'Device offline' });
    api.handler = () => ({ status: 200, body: 'not json' });
    await assert.rejects(client.sendSms('+1', 'x'), /not JSON/);
    api.handler = () => ({ status: 301, headers: { Location: 'https://elsewhere.example/' } });
    await assert.rejects(client.sendSms('+1', 'x'), /redirect to https:\/\/elsewhere\.example\//);
  });

  it('says when SMSTunnel cannot be reached or does not answer in time', async () => {
    await assert.rejects(createClient({ apiKey: KEY, serverUrl: 'http://127.0.0.1:9' }).sendSms('+1', 'x'), (error) => {
      assert.equal(error.status, 0);
      assert.match(error.message, /^Could not reach SMSTunnel at http:\/\/127\.0\.0\.1:9/);
      return true;
    });
    api.handler = () => new Promise((resolve) => setTimeout(() => resolve(sent('late')), 1500));
    const slow = createClient({ apiKey: KEY, serverUrl: api.url, timeoutMs: 300 });
    await assert.rejects(slow.sendSms('+1', 'x'), /no answer within 0.3 s/);
  });

  it('needs a key and an http(s) server URL', () => {
    assert.throws(() => createClient({ apiKey: ' ' }), /API key is required/);
    assert.throws(() => createClient({ apiKey: KEY, serverUrl: 'smstunnel.io' }), /server-url must look like/);
    assert.equal(normalizeServerUrl(''), 'https://smstunnel.io');
  });
});
