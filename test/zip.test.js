import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createZip, crc32 } from '../docs/zip.js';

test('ZIP is readable by Python zipfile with correct Chinese names, binary bytes and CRC', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const blob = createZip([{ name: 'photos/產品照片.png', data: new Uint8Array([0, 255, 137, 80, 78, 71]) }, { name: '圖片來源.csv', data: '\ufeff名稱,來源\r\n產品,https://vendor.example' }]);
  const result = spawnSync('python3', ['-c', 'import sys,io,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nassert z.testzip() is None\nassert z.read("photos/產品照片.png")==bytes([0,255,137,80,78,71])\nassert z.read("圖片來源.csv").decode("utf-8-sig").startswith("名稱,來源")\nprint("ZIP verified")'], { input: Buffer.from(await blob.arrayBuffer()), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /verified/);
});
