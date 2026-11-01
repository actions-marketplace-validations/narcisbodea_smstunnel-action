/**
 * A stand-in SMSTunnel API for the repository's own CI: it accepts every text, answers with ids ci-1, ci-2, ...,
 * and writes its port to fake-api.port in the current folder. It stops by itself after five minutes.
 */
import fs from 'node:fs';
import http from 'node:http';

let count = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const accepted = req.method === 'POST' && /^\/api\/v1\/sms\/send(-2fa)?$/.test(req.url) && req.headers['x-api-key'];
    if (!accepted) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `Cannot ${req.method} ${req.url}`, statusCode: 404 }));
      return;
    }
    const { to } = JSON.parse(raw || '{}');
    count += 1;
    console.log(`${req.url} to ${String(to).slice(-4)}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, messageId: `ci-${count}`, queued: false, data: { messageId: `ci-${count}` } }));
  });
});

server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync('fake-api.port', String(server.address().port));
  console.log(`Stand-in SMSTunnel API on port ${server.address().port}`);
});
setTimeout(() => server.close(), 5 * 60 * 1000).unref();
