/**
 * The bundled action against a real SMSTunnel test server, never production. Skipped unless SMSTUNNEL_E2E_KEY_FILE
 * points to a JSON file { serverUrl, apiKey, deviceId } with a test key. With SMSTUNNEL_E2E_MONGO_URL, each text is
 * also checked in the server's database; the `mongodb` driver is resolved from SMSTUNNEL_E2E_MONGODB_FROM (a folder
 * that has it, such as the SMSTunnel server's).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runAction } from '../support.js';

const BUNDLE = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const KEY_FILE = process.env.SMSTUNNEL_E2E_KEY_FILE;
const TO = process.env.SMSTUNNEL_E2E_TO || '+14155550123';

function readKey() {
  const key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const host = new URL(key.serverUrl).hostname;
  if (host === 'smstunnel.io' || host.endsWith('.smstunnel.io')) {
    throw new Error('The end-to-end tests never run against production. Point the key file at a test server.');
  }
  return key;
}

function openDatabase() {
  if (!process.env.SMSTUNNEL_E2E_MONGO_URL) return null;
  const from = process.env.SMSTUNNEL_E2E_MONGODB_FROM || process.cwd();
  const require = createRequire(path.join(from, 'package.json'));
  const { MongoClient, ObjectId } = require('mongodb');
  const client = new MongoClient(process.env.SMSTUNNEL_E2E_MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  return {
    async expectSent(messageId, to, words, deviceId) {
      await client.connect();
      const deadline = Date.now() + 30000;
      let document;
      do {
        document = await client.db().collection('messages').findOne({ _id: new ObjectId(messageId) });
        if (document?.status !== 'pending') break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
      assert.ok(document, `Text ${messageId} is not in the database.`);
      assert.equal(document.type, 'outgoing');
      assert.equal(document.phoneNumber, to);
      assert.equal(document.message, words);
      assert.ok(['sent', 'delivered'].includes(document.status), `Text ${messageId} is ${document.status}.`);
      if (deviceId) assert.equal(String(document.deviceId), deviceId);
    },
    close: () => client.close(),
  };
}

describe('the bundled action against a test server', { skip: !KEY_FILE && 'Set SMSTUNNEL_E2E_KEY_FILE to run it.' }, () => {
  let key;
  let database;
  before(() => {
    key = readKey();
    database = openDatabase();
  });
  after(async () => {
    await database?.close();
  });

  const inputs = (extra) => ({ 'api-key': key.apiKey, 'server-url': key.serverUrl, 'device-id': key.deviceId, ...extra });

  it('texts two numbers, one text each, and both are stored as sent', async () => {
    const words = `SMSTunnel GitHub Action end-to-end test ${crypto.randomBytes(4).toString('hex')}`;
    const numbers = [TO, '+14155550141'];

    const result = await runAction(BUNDLE, inputs({ to: numbers.join('\n'), message: words }));

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const ids = result.outputs['message-ids'].split(',');
    assert.equal(ids.length, 2);
    for (const id of ids) assert.match(id, /^[a-f0-9]{24}$/);
    assert.ok(!result.stdout.replace(/::add-mask::.*/g, '').includes(TO), 'a number shows in the log');
    for (const [index, id] of ids.entries()) await database?.expectSent(id, numbers[index], words, key.deviceId);
  });

  it('completes a local number with default-country-code', async () => {
    const words = `SMSTunnel GitHub Action country code ${crypto.randomBytes(4).toString('hex')}`;

    const result = await runAction(BUNDLE, inputs({ to: '4155550142', message: words, 'default-country-code': '+1' }));

    assert.equal(result.code, 0, result.stdout + result.stderr);
    await database?.expectSent(result.outputs['message-ids'], '+14155550142', words, key.deviceId);
  });

  it('sends a sign-in code with code: true', async () => {
    const words = `Your SMSTunnel GitHub Action test code is ${crypto.randomInt(100000, 1000000)}`;

    const result = await runAction(BUNDLE, inputs({ to: TO, message: words, code: 'true' }));

    assert.equal(result.code, 0, result.stdout + result.stderr);
    await database?.expectSent(result.outputs['message-ids'], TO, words, key.deviceId);
  });

  it('fails the step when a code text has no code', async () => {
    const result = await runAction(BUNDLE, inputs({ to: TO, message: 'There is no code in this text', code: 'true' }));

    assert.equal(result.code, 1);
    assert.match(result.stdout, /::error::No code went to …\d{4}: .*No valid verification code found.*\(400\)/);
  });

  it('fails the step on a wrong key', async () => {
    const result = await runAction(BUNDLE, inputs({ 'api-key': 'sk_live_this_key_does_not_exist_0000000000', to: TO, message: 'Hi' }));

    assert.equal(result.code, 1);
    assert.match(result.stdout, /Invalid or expired API key \(401\)/);
  });
});
