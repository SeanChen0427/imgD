import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { publicUrl, fetchPublic, readLimited, isPublicIp } from '../src/security.js';

function request(path, body, extra = {}) { return new Request(`https://api.example/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) }); }
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

test('blocks local, encoded local, reserved, IPv6-mapped, and credential-bearing destinations', () => {
  for (const value of ['file:///etc/passwd', 'http://localhost/a', 'http://a.local/a', 'http://127.1/a', 'http://2130706433/a', 'http://0x7f000001/a', 'http://10.0.0.1/a', 'http://169.254.169.254/a', 'http://192.168.1.2/a', 'http://[::1]/a', 'http://[::ffff:127.0.0.1]/a', 'http://user:pass@public.example/a', 'http://public.example:8080/a']) assert.throws(() => publicUrl(value), value);
  assert.equal(isPublicIp('8.8.8.8'), true); assert.equal(isPublicIp('2606:4700:4700::1111'), true); assert.equal(isPublicIp('192.0.2.1'), false);
  assert.equal(publicUrl('https://vendor.example/hello#image').href, 'https://vendor.example/hello');
});

test('validates each redirect before making another request', async () => {
  let count = 0;
  await assert.rejects(fetchPublic('https://vendor.example/', { transport: async () => { count++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }); } }), /非公開/);
  assert.equal(count, 1);
});

test('enforces API password and origin without making outbound requests', async () => {
  const env = { API_TOKEN: 'unit-test', ALLOWED_ORIGINS: 'https://front.example' };
  const transport = () => { throw new Error('unexpected network request'); };
  assert.equal((await handleApi(request('scan-page', {}), env, transport)).status, 401);
  assert.equal((await handleApi(request('scan-page', {}, { Origin: 'https://evil.example', Authorization: 'Bearer unit-test' }), env, transport)).status, 403);
  const response = await handleApi(request('scan-page', {}, { Origin: 'https://front.example', Authorization: 'Bearer unit-test' }), env, transport);
  assert.equal(response.status, 400); assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://front.example');
  assert.equal((await handleApi(request('scan-page', {}), { REQUIRE_TOKEN: 'true' }, transport)).status, 503);
});

test('scans a page and downloads an image with referer, but forwards no frontend credentials', async () => {
  const transport = async (url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    if (url.endsWith('photo.png')) { assert.equal(options.headers.Referer, 'https://vendor.example/product/1'); return new Response(image, { headers: { 'Content-Type': 'image/png' } }); }
    return new Response('<title>測試產品</title><img src="/photo.png">', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  };
  const scan = await handleApi(request('scan-page', { url: 'https://vendor.example/product/1' }), {}, transport);
  assert.equal(scan.status, 200); assert.equal((await scan.json()).images[0].url, 'https://vendor.example/photo.png');
  const photo = await handleApi(request('image', { url: 'https://vendor.example/photo.png', referer: 'https://vendor.example/product/1' }), {}, transport);
  assert.equal(photo.status, 200); assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), image);
});

test('rejects HTML posing as an image, huge images, invalid payloads and non-HTML pages', async () => {
  assert.equal((await handleApi(request('image', { url: 'https://vendor.example/file' }), {}, async () => new Response('<html>verification</html>', { headers: { 'Content-Type': 'text/html' } }))).status, 422);
  assert.equal((await handleApi(request('image', { url: 'https://vendor.example/file' }), {}, async () => new Response(image, { headers: { 'Content-Type': 'image/png', 'Content-Length': 25000000 } }))).status, 413);
  assert.equal((await handleApi(request('scan-page', null))).status, 400);
  assert.equal((await handleApi(request('scan-page', { url: 'https://vendor.example/file' }), {}, async () => new Response(image, { headers: { 'Content-Type': 'image/png' } }))).status, 400);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11)); controller.close(); } });
  await assert.rejects(readLimited(new Response(stream), 10), /太大/);
});
