import { createZip } from './zip.js';

const $ = id => document.getElementById(id);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const apiBase = local ? location.origin : window.IMGD_CONFIG?.apiBase || '';
// Old manual settings must never override the published, working service.
try { localStorage.removeItem('imgd-api'); sessionStorage.removeItem('imgd-token'); } catch { /* private mode */ }
const state = { images: [], logs: [], busy: false, controller: null, scanned: 0, attempted: 0, title: '', source: '' };
let toastTimer;

function notice(message = '', kind = '') { $('notice').textContent = message; $('notice').className = `notice ${kind}`; $('notice').hidden = !message; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000); }
function log(message) {
  state.logs.push(message); const li = document.createElement('li'); li.textContent = message; $('job-log').append(li);
  $('log-details').hidden = false; $('log-summary').textContent = `查看處理紀錄（${state.logs.length}）`;
}
function setBusy(value, kind = '') {
  state.busy = value;
  for (const id of ['scan-button', 'add-url', 'only-this-page', 'filter-noise', 'auto-download', 'page-limit']) $(id).disabled = value;
  for (const control of $('url-list').querySelectorAll('input, button')) control.disabled = value;
  if (!value) refreshUrlControls();
  $('stop-button').hidden = !value; $('progress-card').hidden = !value;
  $('scan-button').querySelector('span').textContent = value ? kind === 'download' ? '正在打包…' : '正在收集…' : '一鍵收集下載';
  updateSelection();
}
function progress(title, detail, done, total) {
  $('progress-title').textContent = title; $('progress-detail').textContent = detail || '';
  $('progress-count').textContent = total ? `${done} / ${total}` : '';
  if (total) { $('progress-bar').max = total; $('progress-bar').value = done; } else $('progress-bar').removeAttribute('value');
}
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const stop = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}
function endpoint(base) {
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('請填入有效的後端網址。');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('公開後端請使用 https 網址。');
  return url.href.replace(/\/$/, '');
}
async function api(path, body, signal) {
  if (!apiBase) throw new Error('服務暫時未就緒，請稍後重新整理再試。');
  const url = `${endpoint(apiBase)}${path}`;
  for (let retry = 0; retry < 3; retry++) {
    let response;
    try {
      response = await fetch(url, {
        method: body ? 'POST' : 'GET', mode: 'cors', credentials: 'omit',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
      });
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new Error(error.name === 'TimeoutError' ? '連線逾時，請稍後再試。' : '目前無法連線到抓圖服務，請稍後重試。');
    }
    if (response.status === 429 && signal && retry < 2) {
      $('progress-detail').textContent = '達到後端頻率限制，稍候 60 秒將自動繼續。';
      await response.body?.cancel(); await pause(60000, signal); continue;
    }
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `後端回應 ${response.status}`); }
    return response;
  }
}
async function checkConnection() {
  const response = await api('/api/health');
  const health = await response.json();
  if (!health.ok || health.name !== 'imgD') throw new Error('服務暫時未就緒。');
  return health;
}
async function refreshConnection() {
  if (!apiBase) { $('connection-label').textContent = '服務暫時未就緒'; $('connection-badge').classList.remove('connected'); return; }
  try {
    await checkConnection();
    $('connection-label').textContent = '服務已就緒';
    $('connection-badge').classList.add('connected');
  } catch { $('connection-label').textContent = '服務暫時無法連線'; $('connection-badge').classList.remove('connected'); }
}

function visibleImages() {
  const term = $('image-search').value.trim().toLowerCase();
  return state.images.filter(image => !term || `${image.alt} ${image.url}`.toLowerCase().includes(term));
}
function updateSelection() {
  const visible = visibleImages(); const selected = state.images.filter(image => image.selected).length;
  $('download-count').textContent = selected;
  $('download-button').disabled = !selected || state.busy;
  $('selected-info').textContent = `已選 ${selected} 張`;
  const checked = visible.filter(image => image.selected).length;
  $('select-all').checked = visible.length > 0 && checked === visible.length;
  $('select-all').indeterminate = checked > 0 && checked < visible.length;
  for (const image of state.images) {
    if (!image.card) continue;
    image.card.classList.toggle('selected', image.selected);
    image.card.querySelector('input').checked = image.selected;
    image.card.querySelector('input').disabled = state.busy;
  }
  $('select-all').disabled = state.busy; $('invert-selection').disabled = state.busy;
}
function svgIcon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg; }
function makeCard(image, index) {
  const card = document.createElement('article'); card.className = 'image-card selected';
  const label = document.createElement('label');
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = image.selected; input.setAttribute('aria-label', `選取 ${image.alt || `照片 ${index + 1}`}`);
  input.addEventListener('change', () => { image.selected = input.checked; updateSelection(); }); label.append(input);
  const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'image-preview'; preview.setAttribute('aria-label', `預覽 ${image.alt || '照片'}`);
  const photo = document.createElement('img'); photo.loading = 'lazy'; photo.decoding = 'async'; photo.referrerPolicy = 'no-referrer'; photo.alt = image.alt; photo.src = image.url;
  photo.addEventListener('error', () => {
    const failed = document.createElement('span'); failed.className = 'preview-failed'; failed.append(svgIcon('image'), document.createTextNode('預覽受限，仍可嘗試下載')); preview.replaceChildren(failed);
  }, { once: true });
  preview.append(photo); preview.addEventListener('click', () => openLightbox(image));
  const info = document.createElement('div'); info.className = 'image-card-info';
  const title = document.createElement('h3'); title.textContent = image.alt || `照片 ${index + 1}`; title.title = image.alt;
  const meta = document.createElement('div'); meta.className = 'image-meta';
  const source = document.createElement('a'); source.href = image.source; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = new URL(image.source).hostname; source.title = '開啟來源網頁';
  const kind = document.createElement('span'); kind.className = 'image-kind'; kind.textContent = image.kind === 'product' ? '產品圖片' : '網頁圖片';
  meta.append(source, kind); info.append(title, meta); card.append(label, preview, info); image.card = card;
  return card;
}
function renderResults() {
  const visible = new Set(visibleImages());
  for (const image of state.images) if (image.card) image.card.hidden = !visible.has(image);
  $('image-count').textContent = state.images.length;
  $('results-toolbar').hidden = !state.images.length; $('collection-footer').hidden = !state.images.length;
  $('empty-state').hidden = !!state.images.length;
  $('no-matches').hidden = !state.images.length || !!visible.size;
  $('collection-description').textContent = state.images.length ? `${state.title || '網頁照片'} · 已合併相同圖片網址` : '照片會出現在這裡，隨時勾選、打包帶走。';
  $('scan-summary').textContent = `已讀取 ${state.scanned} 頁 · ${state.images.length} 張照片`;
  updateSelection();
}
$('image-search').addEventListener('input', renderResults);
$('select-all').addEventListener('change', () => { for (const image of visibleImages()) image.selected = $('select-all').checked; updateSelection(); });
$('invert-selection').addEventListener('click', () => { for (const image of visibleImages()) image.selected = !image.selected; updateSelection(); });

const MAX_URLS = 20;
function urlInputs() { return [...$('url-list').querySelectorAll('.vendor-url')]; }
function refreshUrlControls() {
  const inputs = urlInputs();
  inputs.forEach((input, index) => input.setAttribute('aria-label', `廠商網頁網址 ${index + 1}`));
  // 只剩一列時不顯示 ×，避免把唯一的輸入框刪掉；多列時每列（含第一列）都能刪，寬度一致。
  for (const button of $('url-list').querySelectorAll('.remove-url')) button.hidden = inputs.length < 2;
  $('add-url').disabled = state.busy || inputs.length >= MAX_URLS;
  $('add-url').querySelector('span').textContent = inputs.length >= MAX_URLS ? `最多 ${MAX_URLS} 個連結` : '再加一個連結';
}
function addUrlRow(value = '') {
  if (urlInputs().length >= MAX_URLS) return null;
  const row = $('url-item-template').content.firstElementChild.cloneNode(true);
  const input = row.querySelector('input'); input.value = value;
  $('url-list').append(row); refreshUrlControls();
  return input;
}
$('url-list').addEventListener('click', event => {
  const button = event.target.closest('.remove-url'); if (!button || urlInputs().length < 2) return;
  const row = button.closest('.url-item');
  const next = row.nextElementSibling?.querySelector('input') || row.previousElementSibling?.querySelector('input');
  row.remove(); refreshUrlControls(); next?.focus();
});
$('add-url').addEventListener('click', () => addUrlRow()?.focus());
// 一次貼上多個網址（換行或空白分隔）時，自動拆成多列。
$('url-list').addEventListener('paste', event => {
  const target = event.target; if (!target.classList?.contains('vendor-url')) return;
  const found = (event.clipboardData?.getData('text') || '').match(/https?:\/\/[^\s"'<>]+/g) || [];
  if (found.length < 2) return;
  event.preventDefault(); target.value = found[0];
  for (const url of found.slice(1)) if (!addUrlRow(url)) break;
});
function updateMode() {
  const only = $('only-this-page').checked;
  $('page-limit-label').hidden = only;
  $('mode-hint').textContent = only ? '每個連結只讀取貼上的那一頁，不會跑去其他頁面' : '已取消：會接著收集同網站的產品內頁與下一頁';
}
$('only-this-page').addEventListener('change', updateMode);
updateMode(); refreshUrlControls();

function canonicalPage(value) {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.href;
}
$('scan-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy) return;
  if (!apiBase) { notice('服務暫時未就緒，請稍後重新整理再試。', 'error'); return; }
  const inputs = urlInputs(), starts = [], seenStarts = new Set();
  for (const [index, input] of inputs.entries()) {
    const value = input.value.trim(); if (!value) continue;
    let url;
    try { url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
    catch { notice(`第 ${index + 1} 個連結不是完整的 http 或 https 網址，請檢查後再試。`, 'error'); input.focus(); return; }
    const key = canonicalPage(url.href); if (seenStarts.has(key)) continue;
    seenStarts.add(key); starts.push(url);
  }
  if (!starts.length) { notice('請先貼上至少一個廠商網址。', 'error'); inputs[0]?.focus(); return; }
  const follow = !$('only-this-page').checked, autoDownload = $('auto-download').checked, filterNoise = $('filter-noise').checked;
  const limit = follow ? Number($('page-limit').value) : 1, budget = starts.length * limit, multiple = starts.length > 1;
  state.controller = new AbortController(); const signal = state.controller.signal;
  Object.assign(state, { images: [], logs: [], scanned: 0, attempted: 0, title: '', source: starts[0].href, sources: starts.map(url => url.href) });
  $('image-grid').replaceChildren(); $('job-log').replaceChildren(); $('log-details').hidden = true; $('image-search').value = '';
  notice(); setBusy(true, 'scan'); renderResults();
  const visited = new Set(), seenImages = new Set();
  let interrupted = false, capped = false, fatal = false, lastError = '';
  try {
    for (const [index, start] of starts.entries()) {
      // 每個連結各自一個佇列與頁數上限；「只抓這一頁」時上限就是 1 頁、不追任何連結。
      const label = multiple ? `第 ${index + 1}/${starts.length} 個連結 · ` : '';
      const queue = [canonicalPage(start.href)], queued = new Set(queue);
      let siteOrigin = start.origin, pages = 0;
      while (queue.length && pages < limit && state.images.length < 1500) {
        signal.throwIfAborted(); const url = queue.shift(); if (visited.has(url)) continue;
        visited.add(url); pages++; state.attempted++;
        progress(follow ? `${label}正在收集第 ${pages} 頁` : `${label}正在讀取網頁`, url, state.attempted, follow ? budget : starts.length);
        try {
          const response = await api('/api/scan-page', { url, filterNoise }, signal); const page = await response.json();
          state.scanned++;
          if (!state.title) state.title = multiple ? `${page.title} 等 ${starts.length} 個連結` : page.title;
          if (pages === 1) siteOrigin = new URL(page.url).origin;
          visited.add(canonicalPage(page.url));
          for (const warning of page.warnings) log(warning + ' ' + page.url);
          let added = 0; const fragment = document.createDocumentFragment();
          for (const image of page.images) {
            if (seenImages.has(image.url)) continue;
            seenImages.add(image.url); const item = { ...image, selected: true }; state.images.push(item);
            fragment.append(makeCard(item, state.images.length - 1)); added++;
            if (state.images.length >= 1500) break;
          }
          $('image-grid').append(fragment); log(`讀取完成：新增 ${added} 張 — ${page.url}`);
          if (follow) for (const link of page.links) {
            const candidate = canonicalPage(link.url);
            if (new URL(candidate).origin !== siteOrigin || queued.has(candidate) || visited.has(candidate) || queued.size >= 5000) continue;
            queued.add(candidate); queue.push(candidate);
          }
          renderResults();
        } catch (error) {
          if (signal.aborted) throw error;
          lastError = error.message; log(`讀取失敗：${error.message} — ${url}`);
        }
        if (queue.length && pages < limit) await pause(350, signal);
      }
      if (queue.length && pages >= limit) capped = true;
      if (state.images.length >= 1500) { capped = true; break; }
      if (index < starts.length - 1) await pause(350, signal);
    }
  } catch (error) { if (signal.aborted) interrupted = true; else { notice(error.message, 'error'); fatal = true; } }
  finally { setBusy(false); renderResults(); }
  if (fatal) return;
  if (interrupted) { notice(`已停止收集。保留已找到的 ${state.images.length} 張照片，你仍可勾選下載。`, 'warning'); return; }
  if (!state.scanned) { notice(multiple ? `${starts.length} 個連結都讀取失敗：${lastError}` : lastError, 'error'); return; }
  if (!state.images.length) { notice('沒有找到可讀取的圖片。可改貼產品內頁，或取消「略過 Logo 與明顯小圖」再試。動態載入、需登入或驗證的網站可能無法使用。', 'warning'); return; }
  const failures = state.attempted - state.scanned;
  const tail = `${!follow ? `本次只讀取貼入的${multiple ? ` ${starts.length} 個網頁` : '這一頁'}。` : capped ? '已達本次收集上限，尚有頁面未讀取；可以提高頁數或分批收集。' : '已處理本次找到的可追蹤連結。'}${failures ? `其中 ${failures} 頁讀取失敗，詳見處理紀錄。` : ''}`;
  notice(`找到 ${state.images.length} 張照片，已讀取 ${state.scanned} 頁。${tail}`, capped || failures ? 'warning' : '');
  if (autoDownload) await downloadImages(tail);
});
$('stop-button').addEventListener('click', () => state.controller?.abort());

function safeName(value) { return String(value).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 70) || 'photo'; }
function extension(type, url) {
  const types = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };
  return types[type] || new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'img';
}
function csv(rows) { return '\ufeff' + rows.map(row => row.map(value => { const text = String(value ?? ''); return `"${/^[=+@\-\t\r]/.test(text) ? "'" : ''}${text.replaceAll('"', '""')}"`; }).join(',')).join('\r\n'); }
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function archiveName(extension) { return `imgD_${safeName(new URL(state.source).hostname)}_${new Date().toLocaleDateString('sv-SE')}.${extension}`; }
async function downloadImages(scanNote = '') {
  if (state.busy) return;
  const selected = state.images.filter(image => image.selected); if (!selected.length) return;
  const controller = new AbortController(); state.controller = controller; const signal = controller.signal;
  setBusy(true, 'download');
  const slots = new Array(selected.length); const failures = [], manifest = [['檔名', '名稱', '圖片網址', '來源頁面', '狀態']];
  let cursor = 0, completed = 0, totalBytes = 0, memoryLimit = false;
  progress('正在下載照片並準備 ZIP…', '照片直接打包到你的瀏覽器，不會儲存在後端。', 0, selected.length);
  const download = async () => {
    while (cursor < selected.length && !signal.aborted) {
      const index = cursor++, image = selected[index];
      try {
        const response = await api('/api/image', { url: image.url, referer: image.source }, signal);
        const data = new Uint8Array(await response.arrayBuffer());
        signal.throwIfAborted();
        if (totalBytes + data.length > 250 * 1024 * 1024) { memoryLimit = true; controller.abort(); break; }
        totalBytes += data.length;
        const type = (response.headers.get('content-type') || '').split(';')[0];
        const name = `${String(index + 1).padStart(4, '0')}_${safeName(image.alt)}.${extension(type, image.url)}`;
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        slots[index] = { name, data, digest, image };
      } catch (error) {
        if (!signal.aborted) { failures.push({ image, error: error.message }); log(`下載失敗：${error.message} — ${image.url}`); }
      }
      completed++; progress(`正在打包照片 · ${(totalBytes / 1048576).toFixed(1)} MB`, image.alt || image.url, completed, selected.length);
      if (!signal.aborted && cursor < selected.length) await pause(180, signal).catch(() => {});
    }
  };
  try {
    await Promise.all([download(), download(), download()]);
    const files = [], hashes = new Map(); let duplicates = 0;
    for (const slot of slots) {
      if (!slot) continue;
      const duplicate = hashes.get(slot.digest);
      if (duplicate) { duplicates++; manifest.push([duplicate, slot.image.alt, slot.image.url, slot.image.source, '相同內容，已合併']); continue; }
      hashes.set(slot.digest, slot.name); files.push({ name: `photos/${slot.name}`, data: slot.data });
      manifest.push([slot.name, slot.image.alt, slot.image.url, slot.image.source, '下載成功']);
    }
    for (const failed of failures) manifest.push(['', failed.image.alt, failed.image.url, failed.image.source, `失敗：${failed.error}`]);
    for (let index = 0; index < selected.length; index++) if (!slots[index] && !failures.some(item => item.image === selected[index])) manifest.push(['', selected[index].alt, selected[index].url, selected[index].source, '尚未下載（工作已停止）']);
    if (!files.length) { notice(signal.aborted ? '下載已停止。你可以重新勾選照片後再下載。' : '圖片下載皆未成功，詳見處理紀錄。也可以匯出連結 CSV。', 'warning'); return; }
    const count = files.length;
    files.push({ name: '圖片來源.csv', data: csv(manifest) });
    const note = [
      `imgD 圖片收集紀錄`, `起始網址：${(state.sources || [state.source]).join('\r\n　　　　　')}`, `收集日期：${new Date().toLocaleString('zh-TW')}`, `成功照片：${count}；合併重複：${duplicates}；下載失敗：${failures.length}`,
      scanNote, signal.aborted ? '本次工作已提前停止，ZIP 僅包含完成下載的照片。' : '',
      memoryLimit ? '本次達到 250 MB 打包上限，請分批下載剩餘照片。' : '',
      '這是可讀取的網頁圖片清單，不保證包含網站全部產品。動態載入、登入、驗證、反爬蟲或未追蹤到的分頁可能導致缺圖。',
      '圖片權利屬於原權利人，請確認廠商授權後使用。',
      ...failures.map(item => `下載失敗：${item.image.url}\n原因：${item.error}`),
    ].filter(Boolean).join('\r\n');
    files.push({ name: '下載紀錄.txt', data: note });
    progress('正在產生 ZIP…', `${count} 張照片`, count, count);
    const zip = createZip(files); saveBlob(zip, archiveName('zip'));
    const detail = `${duplicates ? `已合併 ${duplicates} 張相同內容。` : ''}${failures.length ? `${failures.length} 張下載失敗，清單已附在 ZIP。` : ''}${signal.aborted ? memoryLimit ? '已達 250 MB 上限，請分批下載其餘照片。' : '已停止，這次保留已完成的照片。' : ''}`;
    notice(`已打包 ${count} 張照片，ZIP 下載已交給瀏覽器。${detail}${scanNote ? `\n${scanNote}` : ''}`, failures.length || signal.aborted ? 'warning' : '');
    toast(`已打包 ${count} 張照片`);
  } catch (error) { notice(`打包失敗：${error.message}。請減少勾選數量後再試。`, 'error'); }
  finally { setBusy(false); }
}
$('download-button').addEventListener('click', () => downloadImages());
$('manifest-button').addEventListener('click', () => {
  const rows = [['名稱', '圖片網址', '來源頁面', '已選取'], ...state.images.map(image => [image.alt, image.url, image.source, image.selected ? '是' : '否'])];
  saveBlob(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }), archiveName('csv'));
});

function openLightbox(image) {
  $('lightbox-title').textContent = image.alt || '圖片預覽';
  $('lightbox-image').src = image.url; $('lightbox-image').alt = image.alt; $('lightbox-image').referrerPolicy = 'no-referrer';
  $('lightbox-source').href = image.url; $('lightbox').showModal();
}
$('close-lightbox').addEventListener('click', () => $('lightbox').close());
const dialog = $('lightbox');
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
refreshConnection();
