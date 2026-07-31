#!/usr/bin/env node
// Servidor local para el modo CABLE SIN INTERNET.
//
// Sirve los archivos estaticos y reimplementa /api/signal en memoria, con el
// mismo contrato que netlify/functions/signal.mjs. El frontend no cambia nada.
//
// Por que hace falta: getUserMedia exige un origen seguro. http://localhost SI
// lo es, pero http://192.168.x.x NO. Con `adb reverse` el telefono alcanza este
// servidor a traves de su propio localhost, asi que la camara funciona sin
// certificados. El video, en cambio, va por el enlace del anclaje USB.
//
//   node scripts/local-server.mjs [puerto]
//   npm run local
//
// Sin dependencias.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { networkInterfaces } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8888);

// --- buzon en memoria (equivalente a Netlify Blobs) --------------------------
const ROOM_RE = /^[A-Z0-9]{4,12}$/;
const ROLES = ['caller', 'callee'];
const KINDS = ['cam', 'screen'];
const MAX_SDP = 64 * 1024;
const TTL_MS = 10 * 60 * 1000;

const mailbox = new Map();
const key = (room, kind, role) => `${room}/${kind}/${role}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_SDP * 2) reject(new Error('cuerpo demasiado grande'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

async function handleSignal(req, res, url) {
  if (req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'Cuerpo JSON invalido' });
    }
    const { room, kind = 'cam', role, session, description } = body ?? {};
    if (!ROOM_RE.test(room ?? '')) return sendJson(res, 400, { error: 'Sala invalida' });
    if (!KINDS.includes(kind)) return sendJson(res, 400, { error: 'Kind invalido' });
    if (!ROLES.includes(role)) return sendJson(res, 400, { error: 'Rol invalido' });
    if (typeof session !== 'string' || !session) return sendJson(res, 400, { error: 'Falta session' });
    if (!description?.type || typeof description.sdp !== 'string') {
      return sendJson(res, 400, { error: 'Falta description' });
    }
    if (description.sdp.length > MAX_SDP) return sendJson(res, 413, { error: 'SDP demasiado grande' });

    mailbox.set(key(room, kind, role), {
      session,
      description: { type: description.type, sdp: description.sdp },
      at: Date.now(),
    });
    console.log(`  + ${role.padEnd(6)} ${room}/${kind}  (${description.sdp.length} bytes)`);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET') {
    const room = url.searchParams.get('room') ?? '';
    const kind = url.searchParams.get('kind') ?? 'cam';
    const role = url.searchParams.get('role') ?? '';
    if (!ROOM_RE.test(room)) return sendJson(res, 400, { error: 'Sala invalida' });
    if (!KINDS.includes(kind)) return sendJson(res, 400, { error: 'Kind invalido' });
    if (!ROLES.includes(role)) return sendJson(res, 400, { error: 'Rol invalido' });

    const entry = mailbox.get(key(room, kind, role));
    if (!entry) { res.writeHead(204).end(); return; }
    if (Date.now() - entry.at > TTL_MS) {
      mailbox.delete(key(room, kind, role));
      res.writeHead(204).end();
      return;
    }
    return sendJson(res, 200, entry);
  }

  if (req.method === 'DELETE') {
    const room = url.searchParams.get('room') ?? '';
    const kind = url.searchParams.get('kind');
    if (!ROOM_RE.test(room)) return sendJson(res, 400, { error: 'Sala invalida' });
    if (kind && !KINDS.includes(kind)) return sendJson(res, 400, { error: 'Kind invalido' });
    for (const k of kind ? [kind] : KINDS) {
      for (const role of ROLES) mailbox.delete(key(room, k, role));
    }
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: 'Metodo no permitido' });
}

// --- estaticos ---------------------------------------------------------------
// Lista blanca en vez de lista negra: solo lo que la app necesita servir. Asi no
// se filtran package.json, scripts/, .git ni nada que se anada en el futuro.
const ALLOWED = [
  /^[\w.-]+\.html$/,          // index.html, pc.html, phone.html, screen.html...
  /^js\/[\w.-]+\.js$/,        // incluye js/env.generated.js
  /^css\/[\w.-]+\.css$/,
  /^favicon\.(svg|ico)$/,
];

async function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Ruta invalida');
    return;
  }
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html';

  // Normaliza a separadores '/' y quita el prefijo, sin dejar que '..' escale.
  const clean = normalize(rel).split(sep).join('/').replace(/^\/+/, '');

  if (clean.includes('..') || !ALLOWED.some((re) => re.test(clean))) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
    return;
  }

  const target = join(ROOT, clean);
  // Cinturon y tirantes: aunque la lista blanca ya lo impide, confirma que el
  // archivo resuelto sigue dentro del proyecto.
  if (!target.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Prohibido');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('no es un archivo');
    const data = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': data.length,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}

// --- arranque ----------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/api/signal') await handleSignal(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    console.error('  ! ', err.message);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  const usb = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) usb.push(`${a.address}  (${name})`);
    }
  }

  console.log(`
  Camera2PC - servidor local
  --------------------------
  En la PC:        http://localhost:${PORT}/pc.html

  En el telefono, con el cable conectado y anclaje por USB activo:

    1) adb reverse tcp:${PORT} tcp:${PORT}        <- o: npm run usb
    2) abre  http://localhost:${PORT}/phone.html

  Se usa localhost en el telefono porque getUserMedia exige un origen seguro
  y una IP de red local no lo es. El video no pasa por aqui: va directo por
  el enlace del anclaje USB.

  Interfaces de esta PC:
${usb.length ? usb.map((s) => `    ${s}`).join('\n') : '    (ninguna)'}

  Ctrl+C para salir.
`);
});
