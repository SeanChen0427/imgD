import { parseHTML } from 'linkedom';
import { publicUrl } from './security.js';

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?)(?:$|[?#])/i;
const NOISE = /(?:^|[\/_.\s-])(logo|favicon|icon|sprite|spacer|tracking|pixel|loading|placeholder|avatar|social|payment)(?:$|[\/_.\s-])/i;
const PRODUCT_LINK = /products?|items?|goods|catalog|collection|shop|commodity|detail|series|category|產品|商品|系列|分類/i;
const EXCLUDE_LINK = /(?:^|[\/_-])(login|logout|signin|signup|account|cart|checkout|privacy|terms|contact|about|blog|news|search)(?:[\/_.?-]|$)|聯絡|隱私|登入|購物車/i;

function resolve(value, base) {
  if (!value || /^(data|blob|javascript|mailto|tel):/i.test(value.trim())) return null;
  try { return publicUrl(value.trim(), base).href; } catch { return null; }
}

function bestSrcset(value, base) {
  return (value || '').split(',').map(part => {
    const [url, size = '1x'] = part.trim().split(/\s+/);
    return { url: resolve(url, base), size: parseFloat(size) || 1 };
  }).filter(item => item.url).sort((a, b) => b.size - a.size)[0]?.url;
}

function types(value) { return Array.isArray(value) ? value : [value]; }

export function extractPage(html, pageUrl, { filterNoise = true } = {}) {
  const { document } = parseHTML(html);
  const base = resolve(document.querySelector('base[href]')?.getAttribute('href'), pageUrl) || pageUrl;
  const title = (document.querySelector('title')?.textContent || new URL(pageUrl).hostname).trim().slice(0, 200);
  const images = new Map(); const links = new Map();
  function add(value, alt = '', kind = 'page', dimensions = {}) {
    const url = resolve(value, base);
    if (!url || filterNoise && NOISE.test(`${url} ${alt}`)) return;
    if (filterNoise && dimensions.width > 0 && dimensions.width < 100 && dimensions.height > 0 && dimensions.height < 100) return;
    const old = images.get(url);
    if (!old || kind === 'product') images.set(url, { url, alt: String(alt || title).slice(0, 180), kind, source: pageUrl, ...dimensions });
  }
  function readImages(value, name) {
    if (Array.isArray(value)) { value.forEach(item => readImages(item, name)); return; }
    if (typeof value === 'string') { add(value, name, 'product'); return; }
    if (value && typeof value === 'object') { const url = value.contentUrl || value.url; if (url) readImages(url, name); }
  }
  function structured(node, depth = 0) {
    if (!node || depth > 24) return;
    if (Array.isArray(node)) { node.slice(0, 2000).forEach(item => structured(item, depth + 1)); return; }
    if (typeof node !== 'object') return;
    if (types(node['@type']).some(type => /(?:^|\/)Product(?:Group)?$/.test(String(type)))) {
      readImages(node.image, node.name || title);
      const url = resolve(node.url, base); if (url && new URL(url).origin === new URL(pageUrl).origin) links.set(url, { url, score: 100 });
    }
    for (const value of Object.values(node)) if (typeof value === 'object') structured(value, depth + 1);
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { structured(JSON.parse(script.textContent)); } catch { /* malformed structured data is common */ }
  }
  for (const img of document.querySelectorAll('img')) {
    const alt = img.getAttribute('alt') || '';
    const product = img.closest('[itemtype*="Product"], [class*="product"], [class*="Product"], [class*="goods"], [class*="gallery"], [id*="product"]');
    const source = img.closest('picture')?.querySelector('source[srcset], source[data-srcset]');
    const zoom = ['data-zoom-image', 'data-large-image', 'data-original', 'data-full', 'data-large', 'data-image'].map(attr => img.getAttribute(attr)).find(Boolean);
    const srcset = bestSrcset(img.getAttribute('data-srcset') || source?.getAttribute('data-srcset') || img.getAttribute('srcset') || source?.getAttribute('srcset'), base);
    const lazy = ['data-src', 'data-lazy-src', 'data-lazy', 'data-url', 'data-original-src'].map(attr => img.getAttribute(attr)).find(Boolean);
    const href = img.closest('a[href]')?.getAttribute('href');
    const originalLink = href && IMAGE_EXT.test(href) ? href : null;
    const value = originalLink || zoom || srcset || lazy || img.getAttribute('src');
    // Displayed thumbnail dimensions do not describe the original image.
    const dimensions = zoom || srcset || lazy || originalLink ? {} : { width: parseInt(img.getAttribute('width')) || 0, height: parseInt(img.getAttribute('height')) || 0 };
    add(value, alt, product ? 'product' : 'page', dimensions);
  }
  for (const node of document.querySelectorAll('[style]')) {
    const style = node.getAttribute('style') || '';
    for (const match of style.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi)) add(match[1], node.getAttribute('aria-label') || '', 'background');
  }
  for (const meta of document.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"]')) add(meta.getAttribute('content'), title, 'social');
  for (const a of document.querySelectorAll('a[href]')) {
    const url = resolve(a.getAttribute('href'), base); if (!url || new URL(url).origin !== new URL(pageUrl).origin) continue;
    const parsed = new URL(url);
    if (/\.(pdf|zip|xml|jpe?g|png|webp|gif|svg|mp4|csv)(?:$)/i.test(parsed.pathname) || EXCLUDE_LINK.test(parsed.pathname)) continue;
    const text = (a.textContent || '').trim();
    const next = /next/i.test(a.getAttribute('rel') || '') || /^(下一頁|下頁|下一页|next|[›»→])$/i.test(text) || /[?&](page|p|start|offset)=\d+/i.test(url);
    const product = PRODUCT_LINK.test(`${parsed.pathname} ${text}`) || !!a.querySelector('img') || !!a.closest('[class*="product"], [itemtype*="Product"]');
    if (next || product) links.set(url, { url, score: next ? 120 : PRODUCT_LINK.test(parsed.pathname) ? 90 : 50 });
  }
  for (const next of document.querySelectorAll('link[rel="next"][href]')) {
    const url = resolve(next.getAttribute('href'), base);
    if (url && new URL(url).origin === new URL(pageUrl).origin) links.set(url, { url, score: 120 });
  }
  links.delete(pageUrl);
  const result = [...images.values()].sort((a, b) => (b.kind === 'product') - (a.kind === 'product')).slice(0, 1000);
  return {
    title, url: pageUrl, images: result,
    links: [...links.values()].sort((a, b) => b.score - a.score).slice(0, 300),
    warnings: result.length ? [] : ['這一頁沒有找到可讀取的照片。圖片可能由 JavaScript 載入，或網站需要登入／驗證。'],
  };
}
