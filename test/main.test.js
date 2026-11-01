import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SmsTunnelError } from '../src/client.js';
import { run } from '../src/main.js';

const KEY = 'sk_live_test_0123456789abcdef0123456789abcd';

/** A client factory whose sends answer with `behavior(call, index)` (a value, or a thrown error). */
function mockClient(behavior = (call, index) => ({ success: true, messageId: `m${index + 1}`, queued: false })) {
  const calls = [];
  const factory = (options) => {
    factory.options = options;
    const record = (kind) => async (to, message, extra) => {
      calls.push({ kind, to, message, extra });
      return behavior(calls.at(-1), calls.length - 1);
    };
    return { sendSms: record('sms'), sendVerificationCode: record('code') };
  };
  factory.calls = calls;
  return factory;
}

/**
 * Stands in for @actions/core: inputs as the runner gives them, and everything the action reports. (The real
 * @actions/core is exercised by bundle.test.js, which runs dist/index.js like the runner does.)
 */
function fakeCore(inputs) {
  const record = { secrets: [], outputs: {}, info: [], errors: [], failed: null, summary: null };
  const core = {
    getInput(name, options = {}) {
      const value = inputs[name] ?? '';
      return options.trimWhitespace === false ? value : value.trim();
    },
    setSecret: (value) => record.secrets.push(value),
    setOutput: (name, value) => (record.outputs[name] = value),
    info: (line) => record.info.push(line),
    debug: () => {},
    error: (line) => record.errors.push(line),
    setFailed(message) {
      record.failed = message;
      record.errors.push(message);
    },
    summary: {
      rows: null,
      addHeading() {
        return this;
      },
      addTable(rows) {
        this.rows = rows;
        return this;
      },
      async write() {
        record.summary = this.rows;
      },
    },
  };
  return { core, record };
}

async function runWith(inputs, factory, sleep = async () => {}) {
  const { core, record } = fakeCore(inputs);
  await run({ core, createClient: factory, sleep });
  return record;
}

const base = { 'api-key': KEY, to: '+14155550123', message: 'Deploy of main failed' };
const summaryText = (record) => JSON.stringify(record.summary);

describe('the action', () => {
  it('sends one text and sets message-ids', async () => {
    const factory = mockClient();

    const record = await runWith(base, factory);

    assert.equal(record.failed, null);
    assert.deepEqual(factory.calls, [
      { kind: 'sms', to: '+14155550123', message: 'Deploy of main failed', extra: { deviceId: '', defaultCountryCode: '' } },
    ]);
    assert.equal(factory.options.apiKey, KEY);
    assert.equal(factory.options.serverUrl, 'https://smstunnel.io');
    assert.match(factory.options.userAgent, /^smstunnel-action\/1\.0\.0 Node\.js\//);
    assert.deepEqual(record.outputs, { 'message-ids': 'm1' });
    assert.deepEqual(record.info, ['Text to …0123: m1']);
    assert.match(summaryText(record), /…0123/);
  });

  it('hides the key and the numbers from the log, and keeps them out of the summary', async () => {
    const record = await runWith({ ...base, to: '+14155550123, +40 712 345 678' }, mockClient());

    assert.deepEqual(record.secrets, [KEY, '+14155550123', '+40 712 345 678']);
    const shown = JSON.stringify([record.info, record.errors, record.summary]);
    assert.ok(!shown.includes('4155550123') && !shown.includes('712 345 678') && !shown.includes(KEY));
  });

  it('keeps the text as written, spaces and new lines included', async () => {
    const factory = mockClient();

    await runWith({ ...base, message: '  Release 2.4.0 is out.\nNotes: https://example.com  ' }, factory);

    assert.equal(factory.calls[0].message, '  Release 2.4.0 is out.\nNotes: https://example.com  ');
  });

  it('sends one text per number, in order, with the phone and the country code', async () => {
    const factory = mockClient();

    const record = await runWith(
      { ...base, to: '+14155550123, +14155550124\n0712345678', 'device-id': 'phone-1', 'default-country-code': '+40' },
      factory,
    );

    assert.deepEqual(
      factory.calls.map((call) => [call.to, call.extra]),
      [
        ['+14155550123', { deviceId: 'phone-1', defaultCountryCode: '+40' }],
        ['+14155550124', { deviceId: 'phone-1', defaultCountryCode: '+40' }],
        ['0712345678', { deviceId: 'phone-1', defaultCountryCode: '+40' }],
      ],
    );
    assert.equal(record.outputs['message-ids'], 'm1,m2,m3');
  });

  it('sends a sign-in code with code: true, to one number only', async () => {
    const factory = mockClient();
    const sent = await runWith({ ...base, message: 'Your code is 482913', code: 'true' }, factory);
    assert.equal(sent.failed, null);
    assert.equal(factory.calls[0].kind, 'code');
    assert.deepEqual(sent.info, ['Code to …0123: m1']);

    const several = mockClient();
    const refused = await runWith({ ...base, to: '+14155550123, +14155550124', code: 'TRUE' }, several);
    assert.match(refused.failed, /code: true, to must be one number/);
    assert.equal(several.calls.length, 0);
  });

  for (const [title, inputs, pattern] of [
    ['no API key, and says why it can be empty', { ...base, 'api-key': '' }, /api-key is empty.*pull requests from forks/],
    ['no number', { ...base, to: ' , ' }, /to is empty/],
    ['an empty text', { ...base, message: '   ' }, /message is empty/],
    ['code that is not true or false', { ...base, code: 'yes' }, /code must be true or false/],
    ['more than 30 numbers', { ...base, to: Array.from({ length: 31 }, (_, i) => `+1415555${String(i).padStart(4, '0')}`).join(',') }, /at most 30/],
    ['a server URL that is not http(s)', { ...base, 'server-url': 'smstunnel.io' }, /server-url must look like/],
  ]) {
    it(`fails before sending with ${title}`, async () => {
      const factory = mockClient();

      const record = await runWith(inputs, factory);

      assert.match(record.failed ?? '', pattern);
      assert.equal(factory.calls.length, 0);
    });
  }

  it('waits out a 429 as SMSTunnel says, then tries once more', async () => {
    const waits = [];
    const factory = mockClient((call, index) => {
      if (index === 0) throw new SmsTunnelError('Too Many Requests', { status: 429, retryAfter: 7 });
      return { success: true, messageId: 'after-wait' };
    });

    const record = await runWith(base, factory, async (seconds) => waits.push(seconds));

    assert.deepEqual(waits, [7]);
    assert.equal(factory.calls.length, 2);
    assert.equal(record.outputs['message-ids'], 'after-wait');
    assert.equal(record.failed, null);
  });

  it('waits at most a minute, and fails if SMSTunnel still says no', async () => {
    const waits = [];
    const factory = mockClient(() => {
      throw new SmsTunnelError('Too Many Requests', { status: 429, retryAfter: 3600 });
    });

    const record = await runWith(base, factory, async (seconds) => waits.push(seconds));

    assert.deepEqual(waits, [60]);
    assert.equal(factory.calls.length, 2);
    assert.match(record.errors[0], /Too Many Requests \(429\)/);
    assert.match(record.failed, /1 of 1 texts did not go out/);
  });

  it('reports a refused number, texts the others, and fails the step', async () => {
    const factory = mockClient((call, index) => {
      if (call.to === '+1415555') throw new SmsTunnelError('Phone number must contain 7-25 characters', { status: 400 });
      return { success: true, messageId: `m${index + 1}` };
    });

    const record = await runWith({ ...base, to: '+14155550123, +1415555, +14155550125' }, factory);

    assert.equal(factory.calls.length, 3);
    assert.equal(record.outputs['message-ids'], 'm1,,m3');
    assert.match(record.errors[0], /No text went to …5555: Phone number must contain 7-25 characters \(400\)/);
    assert.match(record.failed, /1 of 3 texts did not go out/);
  });

  it('stops at a wrong key: the other numbers would be refused too', async () => {
    const factory = mockClient(() => {
      throw new SmsTunnelError('Invalid or expired API key', { status: 401 });
    });

    const record = await runWith({ ...base, to: '+14155550123, +14155550124, +14155550125' }, factory);

    assert.equal(factory.calls.length, 1);
    assert.equal(record.outputs['message-ids'], ',,');
    assert.match(record.errors[0], /Invalid or expired API key \(401\)/);
    assert.match(summaryText(record), /not tried/);
    assert.match(record.failed, /3 of 3 texts did not go out/);
  });

  it('says when the phone is offline and the text waits for it', async () => {
    const factory = mockClient(() => ({ success: true, messageId: 'q1', queued: true }));

    const record = await runWith(base, factory);

    assert.equal(record.failed, null);
    assert.deepEqual(record.info, ['Text to …0123: q1 (queued: the phone is offline)']);
    assert.match(summaryText(record), /queued: the phone is offline/);
  });

  it('reads the message id from data when the top level has none', async () => {
    const record = await runWith(base, mockClient(() => ({ success: true, data: { messageId: 'd1', queued: false } })));

    assert.equal(record.outputs['message-ids'], 'd1');
  });
});
