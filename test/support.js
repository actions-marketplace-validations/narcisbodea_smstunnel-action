import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/**
 * A stand-in for the SMSTunnel API on a free local port. Each test sets `fake.handler`, which gets the request and
 * returns { status, body, headers } (or a promise of it). Every request is kept in `fake.requests`.
 */
export async function startFakeApi() {
  const fake = { requests: [], handler: () => ({ status: 404, body: { message: 'No handler' } }) };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      const entry = { method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      fake.requests.push(entry);
      const answer = (await fake.handler(entry)) || {};
      const body = answer.body === undefined ? '' : typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
      res.writeHead(answer.status || 200, { 'Content-Type': 'application/json', ...(answer.headers || {}) });
      res.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  fake.reset = () => {
    fake.requests = [];
    fake.handler = () => ({ status: 404, body: { message: 'No handler' } });
  };
  fake.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    });
  return fake;
}

export function sent(id, extra = {}) {
  return {
    status: 200,
    body: { success: true, messageId: id, queued: false, data: { messageId: id, branded: false, queued: false, ...extra } },
  };
}

/** The INPUT_* variables the runner sets for `with:` (names upper-cased, hyphens kept). */
export function inputEnv(inputs) {
  return Object.fromEntries(Object.entries(inputs).map(([name, value]) => [`INPUT_${name.toUpperCase()}`, value]));
}

/** Reads a GITHUB_OUTPUT file: `name<<delimiter`, the value, the delimiter. */
export function readOutputs(file) {
  const outputs = {};
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  for (const match of text.matchAll(/^([^\r\n<]+)<<(\S+)\r?\n([\s\S]*?)\r?\n\2\r?$/gm)) outputs[match[1]] = match[3];
  return outputs;
}

/** Files for GITHUB_OUTPUT and GITHUB_STEP_SUMMARY, in a fresh temporary folder. */
export function runnerFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smstunnel-action-'));
  const output = path.join(dir, 'output.txt');
  const summary = path.join(dir, 'summary.md');
  fs.writeFileSync(output, '');
  fs.writeFileSync(summary, '');
  return { dir, output, summary, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Runs an entry point (the bundle, usually) the way the runner does: `node <entry>` with INPUT_* variables and the
 * runner's files. Resolves with the exit code, what it printed, its outputs and its job summary.
 */
export function runAction(entry, inputs, env = {}) {
  const files = runnerFiles();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        GITHUB_OUTPUT: files.output,
        GITHUB_STEP_SUMMARY: files.summary,
        ...inputEnv(inputs),
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        code,
        stdout,
        stderr,
        outputs: readOutputs(files.output),
        summary: fs.readFileSync(files.summary, 'utf8'),
      };
      files.cleanup();
      resolve(result);
    });
  });
}
