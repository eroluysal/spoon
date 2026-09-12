#!/usr/bin/env node
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

/**
 * Minimal callback receiver for the mock's webhooks.
 *
 * Usage:
 *   API_KEY=esimgo-mock-key PORT=4000 node examples/callback-receiver.mjs
 *
 * Then point the mock at it:
 *   curl -X POST localhost:3000/__mock/callbacks/config \
 *     -H 'Content-Type: application/json' \
 *     -d '{"url":"http://localhost:4000/callback","version":"V3"}'
 */

const port = Number(process.env.PORT ?? 4000);
const apiKey = process.env.API_KEY ?? 'esimgo-mock-key';

/**
 * Verify the `X-Signature-SHA256` header against the raw body, exactly the way
 * eSIM Go documents it: HMAC-SHA256 of the raw bytes, keyed with the API key.
 *
 * @param {string} rawBody Unparsed request body.
 * @param {string|undefined} signatureHeader Value of the X-Signature-SHA256 header.
 * @returns {boolean} True when the signature matches.
 */
function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  return createHmac('sha256', apiKey).update(rawBody).digest('base64') === signatureHeader;
}

createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const signature = request.headers['x-signature-sha256'];
    const valid = verifySignature(raw, Array.isArray(signature) ? signature[0] : signature);

    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      parsed = { raw };
    }

    console.log(
      `[${new Date().toISOString()}] ${request.method} ${request.url} signature=${valid ? 'ok' : signature ? 'MISMATCH' : 'absent'}`,
    );
    console.log(JSON.stringify(parsed, null, 2));

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"received":true}');
  });
}).listen(port, () => {
  console.log(`callback receiver listening on http://localhost:${port}/callback`);
});
