/* Toque — cliente remoto: touchpad por gestos + teclado estilo Magic Keyboard. */
'use strict';

/* ============================== conexión ============================== */

const params = new URLSearchParams(location.search);
const token = params.get('k');

const dot = document.getElementById('dot');
const barStatus = document.getElementById('barStatus');
const overlay = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlayMsg');

let ws = null;
let wsOpen = false;

function setStatus(connected, msg) {
  wsOpen = connected;
  dot.classList.toggle('on', connected);
  barStatus.textContent = connected ? 'conectado' : msg;
  overlay.hidden = connected;
  if (!connected) overlayMsg.textContent = msg;
}

function connect() {
  if (!token) {
    setStatus(false, 'Escanea el código QR que muestra tu PC');
    return;
  }
  ws = new WebSocket(`ws://${location.host}/ws?k=${encodeURIComponent(token)}`);
  ws.onopen = () => setStatus(true, '');
  ws.onclose = () => {
    setStatus(false, 'Sin conexión — reintentando…');
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws.close();
}
connect();

const send = (obj) => {
  if (wsOpen && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
};

/* Mantener la pantalla encendida mientras se usa. */
async function keepAwake() {
  try { await navigator.wakeLock?.request('screen'); } catch {}
}
keepAwake();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});

/* ============================== touchpad ============================== */

const pad = document.getElementById('pad');

const BASE_GAIN = 1.35;   // sensibilidad base
const ACCEL = 0.045;      // aceleración por velocidad
const ACCEL_CAP = 2.4;
const SCROLL_GAIN = 4;    // desplazamiento natural (el contenido sigue al dedo)
const TAP_MS = 260;
const TAP_DIST = 14;
const DOUBLE_TAP_MS = 320;

const pointers = new Map();
let maxPointers = 0;
let mode = 'idle';        // idle | track | scroll | drag
let gestureT0 = 0;
let travelled = 0;
let residX = 0, residY = 0;
let scrollResidX = 0, scrollResidY = 0;
let lastCentroid = null;
let lastTapEnd = 0, lastTapX = 0, lastTapY = 0;

const ripples = new Map();

function centroid() {
  let x = 0, y = 0;
  for (const p of pointers.values()) { x += p.x; y += p.y; }
  return { x: x / pointers.size, y: y / pointers.size };
}

pad.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  pad.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  maxPointers = Math.max(maxPointers, pointers.size);

  const r = document.createElement('div');
  r.className = 'ripple live';
  const rect = pad.getBoundingClientRect();
  r.style.left = e.clientX - rect.left + 'px';
  r.style.top = e.clientY - rect.top + 'px';
  pad.appendChild(r);
  ripples.set(e.pointerId, r);

  if (pointers.size === 1) {
    gestureT0 = performance.now();
    travelled = 0;
    const isDoubleTap =
      performance.now() - lastTapEnd < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 60;
    if (isDoubleTap) {
      mode = 'drag';                 // doble toque y mantener = arrastrar
      pad.classList.add('dragging');
      send({ t: 'dn', b: 0 });
    } else {
      mode = 'track';
    }
  } else if (pointers.size === 2 && mode !== 'drag') {
    mode = 'scroll';
    lastCentroid = centroid();
  }
});

pad.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  travelled += Math.abs(dx) + Math.abs(dy);

  const r = ripples.get(e.pointerId);
  if (r) {
    const rect = pad.getBoundingClientRect();
    r.style.left = e.clientX - rect.left + 'px';
    r.style.top = e.clientY - rect.top + 'px';
  }

  if ((mode === 'track' || mode === 'drag') && pointers.size === 1) {
    const speed = Math.hypot(dx, dy);
    const gain = BASE_GAIN * (1 + Math.min(speed * ACCEL, ACCEL_CAP));
    residX += dx * gain;
    residY += dy * gain;
    const ix = Math.trunc(residX), iy = Math.trunc(residY);
    if (ix || iy) {
      residX -= ix;
      residY -= iy;
      send({ t: 'mv', x: ix, y: iy });
    }
  } else if (mode === 'scroll' && pointers.size >= 2) {
    const c = centroid();
    if (lastCentroid) {
      scrollResidX += -(c.x - lastCentroid.x) * SCROLL_GAIN;
      scrollResidY += (c.y - lastCentroid.y) * SCROLL_GAIN;
      const sx = Math.trunc(scrollResidX), sy = Math.trunc(scrollResidY);
      if (sx || sy) {
        scrollResidX -= sx;
        scrollResidY -= sy;
        send({ t: 'sc', x: sx, y: sy });
      }
    }
    lastCentroid = c;
  }
});

function endPointer(e, cancelled) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);

  const r = ripples.get(e.pointerId);
  if (r) {
    r.classList.remove('live');
    setTimeout(() => r.remove(), 400);
    ripples.delete(e.pointerId);
  }

  if (pointers.size === 1 && mode === 'scroll') lastCentroid = null;

  if (pointers.size === 0) {
    const dt = performance.now() - gestureT0;
    if (mode === 'drag') {
      send({ t: 'up', b: 0 });
      pad.classList.remove('dragging');
      lastTapEnd = 0;
    } else if (!cancelled && dt < TAP_MS && travelled < TAP_DIST) {
      if (maxPointers === 1) {
        send({ t: 'cl', b: 0 });
        lastTapEnd = performance.now();
        lastTapX = e.clientX;
        lastTapY = e.clientY;
      } else if (maxPointers === 2) {
        send({ t: 'cl', b: 1 });   // toque con dos dedos = clic derecho
      }
    }
    mode = 'idle';
    maxPointers = 0;
    lastCentroid = null;
  }
}
pad.addEventListener('pointerup', (e) => endPointer(e, false));
pad.addEventListener('pointercancel', (e) => endPointer(e, true));
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ============================== teclado ============================== */

const VK = {
  esc: 27, tab: 9, enter: 13, backspace: 8, space: 32, del: 46,
  left: 37, up: 38, right: 39, down: 40,
  ctrl: 17, alt: 18, shift: 16, win: 91,
  mute: 173, volDown: 174, volUp: 175, next: 176, prev: 177, play: 179,
};

const ICONS = {
  prev: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9.5 12z"/></svg>',
  play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l11 8-11 8z"/></svg>',
  next: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z"/></svg>',
  mute: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l6 5V4L7 9H3z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  volDown: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l6 5V4L7 9H3z"/><path d="M16.5 12h5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  volUp: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l6 5V4L7 9H3z"/><path d="M19 9.5v5M16.5 12h5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
};

/* Distribución latinoamericana. c = carácter, s = con shift, vk = tecla especial,
   mod = modificador pegajoso, w = ancho, hold = carácter al mantener pulsado. */
const LAYOUT = [
  { fn: true, keys: [
    { vk: VK.esc, l: 'esc', cls: 'fn-key', w: 1.4 },
    { vk: VK.prev, icon: 'prev', cls: 'fn-key' },
    { vk: VK.play, icon: 'play', cls: 'fn-key' },
    { vk: VK.next, icon: 'next', cls: 'fn-key' },
    { vk: VK.mute, icon: 'mute', cls: 'fn-key' },
    { vk: VK.volDown, icon: 'volDown', cls: 'fn-key' },
    { vk: VK.volUp, icon: 'volUp', cls: 'fn-key' },
    { vk: VK.del, l: 'supr', cls: 'fn-key', repeat: true, w: 1.4 },
  ]},
  { keys: [
    { c: '|', s: '°' },
    { c: '1', s: '!' }, { c: '2', s: '"' }, { c: '3', s: '#' }, { c: '4', s: '$' },
    { c: '5', s: '%' }, { c: '6', s: '&' }, { c: '7', s: '/' }, { c: '8', s: '(' },
    { c: '9', s: ')' }, { c: '0', s: '=' }, { c: "'", s: '?' }, { c: '¿', s: '¡' },
    { vk: VK.backspace, l: '⌫', cls: 'mod-key', repeat: true, w: 1.6 },
  ]},
  { keys: [
    { vk: VK.tab, l: '⇥', cls: 'mod-key', w: 1.6 },
    { c: 'q', hold: '@' }, { c: 'w' }, { c: 'e', hold: '€' }, { c: 'r' }, { c: 't' },
    { c: 'y' }, { c: 'u' }, { c: 'i' }, { c: 'o' }, { c: 'p' },
    { dead: '´', c: '´', s: '¨' }, { c: '+', s: '*' },
  ]},
  { keys: [
    { caps: true, l: '⇪', cls: 'mod-key', w: 1.9 },
    { c: 'a' }, { c: 's' }, { c: 'd' }, { c: 'f' }, { c: 'g' }, { c: 'h' },
    { c: 'j' }, { c: 'k' }, { c: 'l' }, { c: 'ñ' },
    { c: '[', s: '{' }, { c: ']', s: '}' },
    { vk: VK.enter, l: '⏎', cls: 'mod-key', w: 1.9 },
  ]},
  { keys: [
    { mod: 'shift', l: '⇧', cls: 'mod-key', w: 2.1 },
    { c: '<', s: '>' },
    { c: 'z' }, { c: 'x' }, { c: 'c' }, { c: 'v' }, { c: 'b' }, { c: 'n' }, { c: 'm' },
    { c: ',', s: ';' }, { c: '.', s: ':' }, { c: '-', s: '_' },
    { mod: 'shift', l: '⇧', cls: 'mod-key', w: 2.1 },
  ]},
  { keys: [
    { mod: 'ctrl', l: 'ctrl', cls: 'mod-key', w: 1.3 },
    { mod: 'alt', l: 'alt', cls: 'mod-key', w: 1.3 },
    { mod: 'win', l: '⌘', cls: 'mod-key', w: 1.3 },
    { vk: VK.space, l: '', w: 5 },
    { vk: VK.left, l: '←', cls: 'mod-key', repeat: true },
    { arrows: true },
    { vk: VK.right, l: '→', cls: 'mod-key', repeat: true },
  ]},
];

const DEAD_MAPS = {
  '´': { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' },
  '¨': { u: 'ü', U: 'Ü', a: 'ä', e: 'ë', i: 'ï', o: 'ö', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö' },
};

const mods = { ctrl: false, alt: false, win: false, shift: false };
let caps = false;
let deadPending = null;
let lastShiftTap = 0;

const modButtons = { ctrl: [], alt: [], win: [], shift: [] };
const letterKeys = [];
let deadKeyBtn = null;
let capsBtn = null;

const kb = document.getElementById('keyboard');

function buzz() { try { navigator.vibrate?.(8); } catch {} }

function refreshUI() {
  for (const [name, btns] of Object.entries(modButtons))
    btns.forEach((b) => b.classList.toggle('active', mods[name]));
  if (capsBtn) capsBtn.classList.toggle('active', caps);
  if (deadKeyBtn) deadKeyBtn.classList.toggle('active', !!deadPending);
  const upper = mods.shift !== caps;
  letterKeys.forEach(({ btn, key }) => {
    btn.firstChild.textContent = upper ? key.c.toUpperCase() : key.c;
  });
}

function clearOneShot() {
  mods.ctrl = mods.alt = mods.win = mods.shift = false;
  refreshUI();
}

const vkForChar = (ch) => {
  if (/^[a-zñ]$/.test(ch)) return ch === 'ñ' ? null : 65 + ch.charCodeAt(0) - 97;
  if (/^[0-9]$/.test(ch)) return 48 + ch.charCodeAt(0) - 48;
  return { '+': 187, ',': 188, '-': 189, '.': 190 }[ch] ?? null;
};

function sendWithMods(fn) {
  const held = [];
  if (mods.ctrl) held.push(VK.ctrl);
  if (mods.alt) held.push(VK.alt);
  if (mods.win) held.push(VK.win);
  if (mods.shift) held.push(VK.shift);
  held.forEach((k) => send({ t: 'kd', k }));
  fn();
  held.reverse().forEach((k) => send({ t: 'ku', k }));
  clearOneShot();
}

function execVK(vk) {
  if (mods.ctrl || mods.alt || mods.win || mods.shift) {
    sendWithMods(() => { send({ t: 'kd', k: vk }); send({ t: 'ku', k: vk }); });
  } else {
    send({ t: 'kd', k: vk });
    send({ t: 'ku', k: vk });
  }
}

function execChar(key) {
  const hardMods = mods.ctrl || mods.alt || mods.win;
  if (hardMods) {
    const vk = vkForChar(key.c);
    if (vk !== null) {
      sendWithMods(() => { send({ t: 'kd', k: vk }); send({ t: 'ku', k: vk }); });
      deadPending = null;
      refreshUI();
      return;
    }
  }
  let ch;
  const isLetter = /^[a-zñ]$/.test(key.c);
  if (isLetter) {
    ch = mods.shift !== caps ? key.c.toUpperCase() : key.c;
  } else {
    ch = mods.shift ? (key.s ?? key.c) : key.c;
  }
  if (deadPending) {
    const composed = DEAD_MAPS[deadPending]?.[ch];
    ch = composed ?? deadPending + ch;
    deadPending = null;
  }
  send({ t: 'tx', s: ch });
  if (mods.shift || mods.ctrl || mods.alt || mods.win) clearOneShot();
  else refreshUI();
}

function pressKey(key) {
  buzz();
  if (key.mod === 'shift') {
    const now = performance.now();
    if (now - lastShiftTap < 350) {           // doble toque en ⇧ = bloq mayús
      caps = true;
      mods.shift = false;
    } else if (caps) {
      caps = false;
      mods.shift = false;
    } else {
      mods.shift = !mods.shift;
    }
    lastShiftTap = now;
    refreshUI();
    return;
  }
  if (key.mod) {
    mods[key.mod] = !mods[key.mod];
    refreshUI();
    return;
  }
  if (key.caps) {
    caps = !caps;
    refreshUI();
    return;
  }
  if (key.dead) {
    const which = mods.shift ? key.s : key.c;
    if (deadPending === which) {
      send({ t: 'tx', s: which });            // dos veces = el carácter tal cual
      deadPending = null;
    } else {
      deadPending = which;
    }
    if (mods.shift) mods.shift = false;
    refreshUI();
    return;
  }
  if (key.vk !== undefined) {
    execVK(key.vk);
    return;
  }
  if (key.c) execChar(key);
}

function buildKeyboard() {
  for (const row of LAYOUT) {
    const rowEl = document.createElement('div');
    rowEl.className = 'krow' + (row.fn ? ' fnrow' : '');
    for (const key of row.keys) {
      if (key.arrows) {
        const stack = document.createElement('div');
        stack.className = 'arrow-stack';
        for (const [vk, label] of [[VK.up, '↑'], [VK.down, '↓']]) {
          const b = makeKeyButton({ vk, l: label, cls: 'mod-key', repeat: true });
          stack.appendChild(b);
        }
        rowEl.appendChild(stack);
        continue;
      }
      rowEl.appendChild(makeKeyButton(key));
    }
    kb.appendChild(rowEl);
  }
  refreshUI();
}

function makeKeyButton(key) {
  const btn = document.createElement('button');
  btn.className = 'key' + (key.cls ? ' ' + key.cls : '');
  btn.style.flexGrow = key.w ?? 1;
  btn.style.flexBasis = 0;

  const label = document.createElement('span');
  if (key.icon) label.innerHTML = ICONS[key.icon];
  else label.textContent = key.l ?? key.c ?? '';
  btn.appendChild(label);

  if (key.s && key.c && key.s !== key.c.toUpperCase()) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = key.s;
    btn.appendChild(hint);
  } else if (key.hold) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = key.hold;
    btn.appendChild(hint);
  }

  if (key.mod) modButtons[key.mod].push(btn);
  if (key.caps) capsBtn = btn;
  if (key.dead) deadKeyBtn = btn;
  if (key.c && /^[a-zñ]$/.test(key.c) && !key.dead) letterKeys.push({ btn, key });

  let repeatTimer = null, repeatInterval = null, holdTimer = null, holdFired = false;

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('pressed');
    holdFired = false;

    if (key.hold) {
      // Las teclas con alternativa (q→@, e→€) disparan al soltar,
      // o la alternativa si se mantienen pulsadas.
      holdTimer = setTimeout(() => {
        holdFired = true;
        buzz();
        send({ t: 'tx', s: key.hold });
        deadPending = null;
        if (mods.shift) clearOneShot();
      }, 450);
      return;
    }

    pressKey(key);

    if (key.repeat) {
      repeatTimer = setTimeout(() => {
        repeatInterval = setInterval(() => pressKey(key), 55);
      }, 420);
    }
  });

  const release = () => {
    btn.classList.remove('pressed');
    clearTimeout(repeatTimer);
    clearInterval(repeatInterval);
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
      if (!holdFired && key.hold) pressKey(key);
    }
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);

  return btn;
}

buildKeyboard();

/* ---- mostrar / ocultar teclado ---- */
const kbToggle = document.getElementById('kbToggle');
function setKbHidden(hidden) {
  document.body.classList.toggle('kb-hidden', hidden);
  kbToggle.classList.toggle('active', !hidden);
  localStorage.setItem('kbHidden', hidden ? '1' : '0');
}
kbToggle.addEventListener('click', () =>
  setKbHidden(!document.body.classList.contains('kb-hidden'))
);
setKbHidden(localStorage.getItem('kbHidden') === '1');
