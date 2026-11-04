import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPage } from '../src/extract.js';

const page = 'https://vendor.example/catalog?page=1';
test('collects JSON-LD, originals, srcset, lazy images, and CSS backgrounds without duplicate URLs', () => {
  const result = extractPage(`<html><head><title>木作家具</title><base href="/assets/"><script type="application/ld+json">{"@graph":[{"@type":"Product","name":"實木椅","image":["/images/chair.jpg",{"contentUrl":"/images/chair-detail.webp"}]}]}</script></head><body>
    <div class="product"><img alt="椅子" src="thumb.jpg" data-zoom-image="/images/chair.jpg" width="40" height="40"></div>
    <img alt="桌子" src="small.jpg" srcset="small.jpg 320w, table-large.jpg 1600w">
    <picture><source data-srcset="lamp.webp 1x, lamp-large.webp 2x"><img src="fallback.jpg"></picture>
    <img src="blank.gif" data-src="lazy.jpg"><a href="/images/full.jpg"><img src="tiny.jpg"></a>
    <img src="logo.png"><img src="tracking.gif" width="1" height="1"><div style="background-image:url('/images/room.jpg')"></div>
    <a href="/product/chair">椅子</a><a href="?page=2" rel="next">下一頁</a><a href="https://other.example/product/chair">external</a><a href="/cart">cart</a>
    </body></html>`, page);
  assert.equal(result.title, '木作家具');
  const urls = result.images.map(image => image.url);
  assert.equal(new Set(urls).size, urls.length);
  for (const name of ['https://vendor.example/images/chair.jpg', 'https://vendor.example/images/chair-detail.webp', 'https://vendor.example/assets/table-large.jpg', 'https://vendor.example/assets/lamp-large.webp', 'https://vendor.example/assets/lazy.jpg', 'https://vendor.example/images/full.jpg', 'https://vendor.example/images/room.jpg']) assert.ok(urls.includes(name), name);
  assert.ok(!urls.some(url => /thumb|small|fallback|blank|tiny|logo|tracking/.test(url)));
  assert.equal(result.images.find(image => image.url.endsWith('chair.jpg')).kind, 'product');
  assert.ok(result.links.some(link => link.url === 'https://vendor.example/product/chair'));
  assert.ok(result.links.some(link => link.url.includes('page=2')));
  assert.ok(!result.links.some(link => /other.example|\/cart/.test(link.url)));
});

test('can include small images on request; ignores malformed metadata and unsafe image URLs', () => {
  const html = '<script type="application/ld+json">broken</script><img src="/logo.png"><img src="http://127.0.0.1/x.jpg"><img src="data:image/png;base64,a">';
  assert.equal(extractPage(html, page).images.length, 0);
  assert.equal(extractPage(html, page, { filterNoise: false }).images.length, 1);
});

test('does not remove signed image query parameters', () => {
  const result = extractPage('<img src="https://cdn.example/image?token=abc&amp;width=900">', page);
  assert.equal(result.images[0].url, 'https://cdn.example/image?token=abc&width=900');
});
