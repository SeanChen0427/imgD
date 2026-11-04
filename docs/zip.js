// ZIP STORE writer. JPEG/WebP/PNG are already compressed; no external CDN required.
// Unicode filenames, CRC-32, central directory, and DOS timestamps follow PKZIP.
const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size) {
  const bytes = new Uint8Array(size); const view = new DataView(bytes.buffer);
  return { bytes, u16: (offset, value) => view.setUint16(offset, value, true), u32: (offset, value) => view.setUint32(offset, value, true) };
}
export function createZip(files) {
  if (files.length > 65535) throw new Error('ZIP 檔案數量過多。');
  const parts = [], central = []; let offset = 0;
  const now = new Date();
  const time = now.getHours() << 11 | now.getMinutes() << 5 | now.getSeconds() >> 1;
  const date = Math.max(0, now.getFullYear() - 1980) << 9 | now.getMonth() + 1 << 5 | now.getDate();
  for (const file of files) {
    const name = encoder.encode(file.name); const data = file.data instanceof Uint8Array ? file.data : encoder.encode(file.data);
    if (name.length > 65535 || offset + data.length > 0xffffffff) throw new Error('ZIP 檔案太大，請分批下載。');
    const crc = crc32(data); const local = header(30);
    local.u32(0, 0x04034b50); local.u16(4, 20); local.u16(6, 0x0800); local.u16(10, time); local.u16(12, date);
    local.u32(14, crc); local.u32(18, data.length); local.u32(22, data.length); local.u16(26, name.length);
    const entry = header(46);
    entry.u32(0, 0x02014b50); entry.u16(4, 20); entry.u16(6, 20); entry.u16(8, 0x0800); entry.u16(12, time); entry.u16(14, date);
    entry.u32(16, crc); entry.u32(20, data.length); entry.u32(24, data.length); entry.u16(28, name.length); entry.u32(42, offset);
    parts.push(local.bytes, name, data); central.push(entry.bytes, name); offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = header(22); end.u32(0, 0x06054b50); end.u16(8, files.length); end.u16(10, files.length); end.u32(12, centralSize); end.u32(16, offset);
  return new Blob([...parts, ...central, end.bytes], { type: 'application/zip' });
}
