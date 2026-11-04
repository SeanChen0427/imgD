import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { handleApi } from './src/api.js';
import { AppError, publicUrl, isPublicIp } from './src/security.js';

// Resolve once and pin the validated address to the socket to prevent DNS rebinding.
export async function nodeTransport(value, options) {
  const url = publicUrl(value);
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some(item => !isPublicIp(item.address))) throw new AppError('網站沒有可存取的公開網路位址。');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const remote = client.request(url, {
      method: 'GET', headers: { ...options.headers, 'Accept-Encoding': 'identity' }, signal: options.signal,
      lookup: (_hostname, settings, callback) => settings.all ? callback(null, [address]) : callback(null, address.address, address.family),
    }, incoming => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const empty = [204, 205, 304].includes(incoming.statusCode);
      if (empty) incoming.resume();
      resolve(new Response(empty ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers }));
    });
    remote.on('error', reject); remote.end();
  });
}

const root = new URL('./docs/', import.meta.url);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT) || 8787;
const server = http.createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  outgoing.on('close', () => { if (!outgoing.writableEnded) controller.abort(); });
  try {
    const url = new URL(incoming.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/api/')) {
      const request = new Request(url, { method: incoming.method, headers: incoming.headers, signal: controller.signal, ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }) });
      const env = { ...process.env, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port}` };
      const response = await handleApi(request, env, nodeTransport);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(outgoing); else outgoing.end();
      return;
    }
    if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405); outgoing.end(); return; }
    const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = new URL(`.${path}`, root);
    if (!file.href.startsWith(root.href)) { outgoing.writeHead(403); outgoing.end(); return; }
    const bytes = await readFile(fileURLToPath(file));
    const extension = file.pathname.slice(file.pathname.lastIndexOf('.'));
    outgoing.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    outgoing.end(incoming.method === 'HEAD' ? undefined : bytes);
  } catch { if (!outgoing.headersSent) outgoing.writeHead(404); outgoing.end('Not found'); }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(port, '127.0.0.1', () => console.log(`imgD is ready: http://localhost:${port}`));
}
