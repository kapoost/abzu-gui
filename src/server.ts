import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? '0.0.0.0';
const ABZU_BASE_URL = process.env.ABZU_BASE_URL ?? 'http://localhost:8787';

const ROOT = resolve(import.meta.dir, '..', 'public');

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
  return tmpl.replace(/__ABZU_BASE_URL__/g, ABZU_BASE_URL);
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
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    if (pathname.startsWith('/')) pathname = pathname.slice(1);
    if (pathname.includes('..')) return new Response('not found', { status: 404 });
    const filePath = join(ROOT, pathname);
    if (!filePath.startsWith(ROOT)) return new Response('not found', { status: 404 });
    if (!existsSync(filePath)) return new Response('not found', { status: 404 });
    const stat = statSync(filePath);
    if (!stat.isFile()) return new Response('not found', { status: 404 });
    const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
    return new Response(Bun.file(filePath), {
      status: 200,
      headers: { 'content-type': mime },
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
