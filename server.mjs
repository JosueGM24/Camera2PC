// Toque — servidor local: sirve la interfaz al teléfono y traduce sus
// eventos a entradas reales de mouse/teclado en Windows (via input-helper.ps1).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8765;
const TOKEN_FILE = path.join(__dirname, '.token');

// ---- token estable entre reinicios (el QR no cambia) ----
function loadToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (/^[A-Z2-9]{6}$/.test(t)) return t;
  } catch {}
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L
  let t = '';
  while (t.length < 6) t += alphabet[crypto.randomInt(alphabet.length)];
  fs.writeFileSync(TOKEN_FILE, t);
  return t;
}
const TOKEN = loadToken();

function lanIP() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) candidates.push(net.address);
    }
  }
  return (
    candidates.find((ip) => ip.startsWith('192.168.')) ??
    candidates.find((ip) => ip.startsWith('10.')) ??
    candidates[0] ??
    '127.0.0.1'
  );
}
const remoteURL = () => `http://${lanIP()}:${PORT}/r?k=${TOKEN}`;

// ---- helper de inyección (PowerShell + SendInput) ----
let helper = null;
function startHelper() {
  helper = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'input-helper.ps1')],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  helper.stdout.on('data', (d) => {
    if (String(d).includes('ready')) console.log('✓ Inyector de entrada listo');
  });
  helper.stderr.on('data', (d) => console.error('[helper]', String(d).trim()));
  helper.on('exit', (code) => {
    console.error(`El inyector terminó (código ${code}); reiniciando…`);
    setTimeout(startHelper, 1000);
  });
}
const inject = (line) => {
  if (helper?.stdin.writable) helper.stdin.write(line + '\n');
};

// ---- protocolo teléfono → helper ----
const int = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
};
function handleMessage(raw) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  switch (m.t) {
    case 'mv':
      inject(`m ${int(m.x, -4096, 4096)} ${int(m.y, -4096, 4096)}`);
      break;
    case 'sc':
      inject(`s ${int(m.x, -2400, 2400)} ${int(m.y, -2400, 2400)}`);
      break;
    case 'dn':
      inject(`d ${int(m.b, 0, 2)}`);
      break;
    case 'up':
      inject(`u ${int(m.b, 0, 2)}`);
      break;
    case 'cl': {
      const b = int(m.b, 0, 2);
      inject(`d ${b}`);
      inject(`u ${b}`);
      break;
    }
    case 'kd':
      inject(`k ${int(m.k, 1, 254)} 1`);
      break;
    case 'ku':
      inject(`k ${int(m.k, 1, 254)} 0`);
      break;
    case 'tx':
      if (typeof m.s === 'string' && m.s.length <= 512)
        inject(`t ${Buffer.from(m.s, 'utf8').toString('base64')}`);
      break;
  }
}

// ---- HTTP ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};
const isLoopback = (req) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

let padCount = 0;

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');

  if (pathname === '/info') {
    // Solo la propia PC puede ver el QR/token.
    if (!isLoopback(req)) {
      res.writeHead(403).end();
      return;
    }
    const url = remoteURL();
    const svg = await QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: '#1d1d1f', light: '#ffffff00' } });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url, svg, connected: padCount > 0 }));
    return;
  }

  let file;
  if (pathname === '/') file = 'index.html';
  else if (pathname === '/r') file = 'remote.html';
  else file = pathname.slice(1);

  const full = path.join(PUBLIC, path.normalize(file));
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404).end('No encontrado');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(full)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(full).pipe(res);
});

// ---- WebSocket ----
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, 'http://x');
  if (pathname !== '/ws' || searchParams.get('k') !== TOKEN) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    padCount++;
    console.log(`✓ Dispositivo conectado (${padCount})`);
    ws.on('message', (data) => handleMessage(data.toString()));
    ws.on('close', () => {
      padCount--;
      console.log(`✗ Dispositivo desconectado (${padCount})`);
    });
  });
});

// ---- arranque ----
startHelper();
server.listen(PORT, '0.0.0.0', async () => {
  const url = remoteURL();
  console.log('\n  Toque — teclado y trackpad remotos\n');
  console.log(`  En tu teléfono/tablet abre:  ${url}`);
  console.log(`  O escanea el QR en la PC:    http://localhost:${PORT}\n`);
  try {
    console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
  } catch {}
  exec(`start "" "http://localhost:${PORT}"`);
});
