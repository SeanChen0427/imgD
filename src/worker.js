import { handleApi } from './api.js';
import { AppError, isPublicIp, publicUrl } from './security.js';

// Reject DNS names resolving to private networks as well as literal private IPs.
async function workerTransport(url, options) {
  const host = publicUrl(url).hostname.replace(/^\[|\]$/g, '');
  if (!isPublicIp(host)) {
    const answers = await Promise.all([1, 28].map(async type => {
      const dnsUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`;
      const result = await fetch(dnsUrl, { headers: { Accept: 'application/dns-json' }, signal: options.signal });
      if (!result.ok) throw new AppError('無法查詢網站位址。', 502);
      const data = await result.json();
      if (![0, 3].includes(data.Status)) throw new AppError('無法查詢網站位址。', 502);
      return (data.Answer || []).filter(item => [1, 28].includes(item.type)).map(item => item.data);
    }));
    const ips = answers.flat();
    if (!ips.length || ips.some(ip => !isPublicIp(ip))) throw new AppError('網站沒有可存取的公開網路位址。');
  }
  // Workers' public fetch has no VPC binding and cannot route to private addresses.
  return fetch(url, options);
}

export default { fetch(request, env) { return handleApi(request, env, workerTransport); } };
