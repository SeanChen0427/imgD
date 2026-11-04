import ipaddr from 'ipaddr.js';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function publicUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw new AppError('請輸入完整的 http 或 https 網址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AppError('只支援不含帳號密碼的公開 http／https 網址。');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) || !host.includes('.') && !host.includes(':')) {
    throw new AppError('只支援公開網站，無法讀取本機或內部網路。');
  }
  if (ipaddr.isValid(host) && !isPublicIp(host)) throw new AppError('無法讀取非公開網路位址。');
  if (url.port && !['80', '443'].includes(url.port)) throw new AppError('僅支援標準網頁連接埠 80 與 443。');
  url.hash = '';
  return url;
}

export function isPublicIp(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === 'unicast';
  } catch { return false; }
}

export async function readLimited(response, limit = 5 * 1024 * 1024) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new AppError('檔案太大，已略過。', 413);
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new AppError('檔案太大，已略過。', 413);
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

// Redirects are checked individually. No cookies or authorization are forwarded.
export async function fetchPublic(value, { transport = fetch, signal, referer, accept = 'text/html,application/xhtml+xml' } = {}) {
  let url = publicUrl(value);
  for (let redirect = 0; redirect <= 5; redirect++) {
    let response;
    try {
      response = await transport(url.href, {
        method: 'GET', redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(18000)]) : AbortSignal.timeout(18000),
        headers: {
          'User-Agent': 'imgD/1.0 (product-image-collector)',
          Accept: accept,
          ...(referer ? { Referer: publicUrl(referer).href } : {}),
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (signal?.aborted) throw new AppError('工作已取消。', 499);
      throw new AppError('網站連線逾時或無法連線，請稍後再試。', 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new AppError('網站的重新導向無效。', 502);
      url = publicUrl(location, url.href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403, 429, 503].includes(response.status)) throw new AppError(`網站拒絕自動存取（${response.status}），可能需要登入或驗證。`, 502);
      throw new AppError(`網站回應 ${response.status}，無法讀取。`, 502);
    }
    return { response, url: url.href };
  }
  throw new AppError('網站重新導向過多。', 502);
}
