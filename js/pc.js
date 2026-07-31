import { clearRoom } from './signaling.js';
import { startReceiver } from './receiver.js';
import { createLink, paintIcons, rememberFolds, setIcon, flashConfirm } from './ui.js';
import {
  params, randomRoomCode, normalizeRoomCode, absoluteUrl,
  CONNECTION_LABELS, makeStatus, formatConnection,
} from './util.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'camera2pc.room';

paintIcons();
rememberFolds();

// --- sala -------------------------------------------------------------------
const roomId =
  normalizeRoomCode(params.get('room')) ||
  normalizeRoomCode(localStorage.getItem(STORE_KEY)) ||
  randomRoomCode();
localStorage.setItem(STORE_KEY, roomId);

const phoneUrl = absoluteUrl('phone.html', { room: roomId });
const obsUrl = absoluteUrl('obs.html', { room: roomId });

$('code').textContent = roomId;
$('phoneUrl').value = phoneUrl;
$('obsUrl').value = obsUrl;

// --- QR (si el CDN no carga, queda el codigo y el enlace) -------------------
(function renderQr() {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
  script.onload = () => {
    window.QRCode.toCanvas($('qr'), phoneUrl,
      { width: 360, margin: 0, color: { dark: '#1e1f23', light: '#ffffff' } },
      (err) => { if (err) $('qrBox').hidden = true; });
  };
  script.onerror = () => { $('qrBox').hidden = true; };
  document.head.appendChild(script);
})();

// --- camino de la senal -----------------------------------------------------
const link = createLink($('link'), {
  from: 'phone', to: 'pc', fromLabel: 'Telefono', toLabel: 'Esta PC',
});

// --- receptor ---------------------------------------------------------------
const video = $('video');
const stage = $('stage');
const setStatus = makeStatus($('dot'), $('statusText'));
let lastBytes = 0;
let lastTs = 0;
let routeTimer = null;

const onState = (state, message) => {
  const [label, kind] = CONNECTION_LABELS[state] || [state, 'idle'];
  setStatus(message || label, kind);
  link.setState(state);

  const live = state === 'connected';
  stage.classList.toggle('live', live);
  for (const id of ['btnSnap', 'btnRec', 'btnAudio']) $(id).disabled = !live;

  if (live) {
    watchRoute();
  } else {
    clearInterval(routeTimer);
    routeTimer = null;
    $('stats').textContent = '';
    $('route').textContent = '';
    lastBytes = 0;
    lastTs = 0;
  }
};

const onStats = (s) => {
  const now = performance.now();
  let rate = '';
  if (lastTs && s.bytes >= lastBytes) {
    rate = `  ${Math.round(((s.bytes - lastBytes) * 8) / (now - lastTs))} kbps`;
  }
  lastBytes = s.bytes;
  lastTs = now;
  $('stats').textContent = `${s.width}x${s.height}  ${s.fps} fps${rate}  perdidos ${s.packetsLost}`;
};

const receiver = startReceiver({ roomId, videoEl: video, onState, onStats });

// La ruta elegida confirma si el trafico va por cable o por Wi-Fi.
function watchRoute() {
  clearInterval(routeTimer);
  const tick = async () => {
    const info = await receiver.route().catch(() => null);
    if (!info) return;
    link.setState('connected', info);
    $('route').textContent = formatConnection(info);
  };
  tick();
  routeTimer = setInterval(tick, 3000);
}

// --- herramientas sobre el video -------------------------------------------
$('btnFull').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen?.();
};

$('btnAudio').onclick = () => {
  video.muted = !video.muted;
  const btn = $('btnAudio');
  setIcon(btn.querySelector('svg'), video.muted ? 'mute' : 'sound');
  btn.title = video.muted ? 'Activar audio' : 'Silenciar';
  btn.setAttribute('aria-label', btn.title);
};

$('btnSnap').onclick = () => {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    download(blob, `captura-${stamp()}.png`);
    flashConfirm($('btnSnap'));
  }, 'image/png');
};

let recorder = null;
$('btnRec').onclick = () => {
  const btn = $('btnRec');
  if (recorder) { recorder.stop(); return; }

  const chunks = [];
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(video.srcObject, { mimeType: mime });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    download(new Blob(chunks, { type: mime }), `grabacion-${stamp()}.webm`);
    recorder = null;
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Grabar video';
  };
  recorder.start(1000);
  btn.setAttribute('aria-pressed', 'true');
  btn.title = 'Detener grabacion';
};

// --- sala -------------------------------------------------------------------
const copy = async (input, button) => {
  input.select();
  try { await navigator.clipboard.writeText(input.value); } catch { document.execCommand('copy'); }
  flashConfirm(button);
};
$('btnCopyPhone').onclick = () => copy($('phoneUrl'), $('btnCopyPhone'));
$('btnCopyObs').onclick = () => copy($('obsUrl'), $('btnCopyObs'));

$('btnNew').onclick = () => {
  const code = randomRoomCode();
  localStorage.setItem(STORE_KEY, code);
  location.search = `?room=${code}`;
};

$('btnReset').onclick = async () => {
  $('btnReset').disabled = true;
  await clearRoom(roomId).catch(console.warn);
  receiver.rearm();
  $('btnReset').disabled = false;
};

// --- helpers ----------------------------------------------------------------
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
