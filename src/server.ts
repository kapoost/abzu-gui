import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? '0.0.0.0';
const ABZU_BASE_URL = process.env.ABZU_BASE_URL ?? 'http://localhost:8787';

const ROOT = resolve(import.meta.dir, '..', 'public');

// Cache-buster derived at boot from public/app.js contents. Cloudflare's
// default page rule caches /app.js for hours regardless of origin
// Cache-Control, so any HTML we serve links to app.js?v=<hash>. Same
// mechanism for styles.css so a redeployed stylesheet lands immediately.
function fileHash(name: string): string {
  const p = join(ROOT, name);
  if (!existsSync(p)) return 'dev';
  return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12);
}
const APP_JS_HASH = fileHash('app.js');
const STYLES_CSS_HASH = fileHash('styles.css');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function configPage(): string {
  const tmpl = readFileSync(join(ROOT, 'index.html'), 'utf8');
  return tmpl
    .replace(/__ABZU_BASE_URL__/g, ABZU_BASE_URL)
    // Append content-derived hashes so CF's edge cache serves the freshly
    // deployed bundle instead of the stale copy pinned to the plain path.
    .replace(/src="\/app\.js"/g, `src="/app.js?v=${APP_JS_HASH}"`)
    .replace(/href="\/styles\.css"/g, `href="/styles.css?v=${STYLES_CSS_HASH}"`);
}

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;
    if (pathname === '/' || pathname === '/sam' || pathname === '/jordan' || pathname === '/sponsor') {
      return new Response(configPage(), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          // Iterate fast — Cloudflare edge otherwise pins the old app.js
          // reference for the full default TTL, so a freshly-deployed
          // feature is invisible until cache expiry. no-store here + on
          // app.js/styles.css below makes every visit hit origin.
          'cache-control': 'no-store',
        },
      });
    }
    if (pathname.startsWith('/')) pathname = pathname.slice(1);
    if (pathname.includes('..')) return new Response('not found', { status: 404 });
    const filePath = join(ROOT, pathname);
    if (!filePath.startsWith(ROOT)) return new Response('not found', { status: 404 });
    if (!existsSync(filePath)) return new Response('not found', { status: 404 });
    const stat = statSync(filePath);
    if (!stat.isFile()) return new Response('not found', { status: 404 });
    const ext = extname(filePath);
    const mime = MIME[ext] ?? 'application/octet-stream';
    // App shell assets change on every deploy — skip cache so buyers see
    // freshly shipped features without a hard refresh. Static images and
    // fonts keep their default caching.
    const noCache = ext === '.js' || ext === '.css' || ext === '.html';
    const headers: Record<string, string> = { 'content-type': mime };
    if (noCache) headers['cache-control'] = 'no-store';
    return new Response(Bun.file(filePath), {
      status: 200,
      headers,
    });
  },
});

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  level: 'info',
  agent: 'abzu-gui',
  msg: 'listening',
  url: `http://${HOST}:${PORT}`,
  abzu: ABZU_BASE_URL,
}));
