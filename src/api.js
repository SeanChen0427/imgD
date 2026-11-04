import { AppError, fetchPublic, publicUrl, readLimited } from './security.js';
import { extractPage } from './extract.js';

export async function handleApi(request, env = {}, transport = fetch) {
  const path = new URL(request.url).pathname;
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean);
  const cors = { 'Vary': 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (origin && allowed.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
  const json = (data, status = 200) => Response.json(data, { status, headers: cors });
  try {
    if (origin && !allowed.includes(origin)) throw new AppError('這個前台網址尚未被後端允許，請檢查 ALLOWED_ORIGINS。', 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    if (path === '/api/health' && request.method === 'GET') return json({ ok: true, name: 'imgD' });
    if (request.method !== 'POST') throw new AppError('不支援此請求。', 405);
    if (!['/api/scan-page', '/api/image'].includes(path)) throw new AppError('找不到這個功能。', 404);
    if (env.RATE_LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) throw new AppError('請求較密集，請稍候一分鐘再試。', 429);
    }
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('請使用 JSON 請求。', 415);
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await readLimited(request, 16000))); } catch { throw new AppError('請求內容無效。'); }
    if (!body || typeof body.url !== 'string' || body.url.length > 6000) throw new AppError('請輸入有效網址。');
    const target = publicUrl(body.url);
    if (path === '/api/scan-page') {
      const { response, url } = await fetchPublic(target.href, { transport, signal: request.signal });
      if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new AppError('這個網址不是網頁，請貼入產品頁或分類頁的網址。'); }
      const bytes = await readLimited(response);
      const declared = response.headers.get('content-type')?.match(/charset=["']?([\w-]+)/i)?.[1];
      const meta = new TextDecoder().decode(bytes.slice(0, 3000)).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
      let decoder;
      try { decoder = new TextDecoder(declared || meta || 'utf-8'); } catch { decoder = new TextDecoder(); }
      return json(extractPage(decoder.decode(bytes), url, { filterNoise: body.filterNoise !== false }));
    }
    const referer = typeof body.referer === 'string' ? publicUrl(body.referer).href : undefined;
    const { response, url } = await fetchPublic(target.href, { transport, signal: request.signal, referer, accept: 'image/avif,image/webp,image/*;q=0.9,*/*;q=0.5' });
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp|avif|gif|bmp|tiff|svg\+xml|x-icon|vnd.microsoft.icon)$/.test(type)) {
      await response.body?.cancel(); throw new AppError('網址沒有回傳圖片，可能被網站阻擋。', 422);
    }
    const bytes = await readLimited(response, 20 * 1024 * 1024);
    if (!bytes.length) throw new AppError('圖片檔案是空的。', 422);
    return new Response(bytes, { headers: { ...cors, 'Content-Type': type, 'Content-Disposition': 'attachment', 'X-Image-Url': encodeURIComponent(url) } });
  } catch (error) {
    return json({ error: error instanceof AppError ? error.message : '處理時發生錯誤，請稍後再試。' }, error instanceof AppError ? error.status : 500);
  }
}
