import { clearRoom } from './signaling.js';
import { startReceiver } from './receiver.js';
import {
  params, randomRoomCode, normalizeRoomCode, absoluteUrl,
  CONNECTION_LABELS, makeStatus,
} from './util.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'camera2pc.room';

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

// --- QR (opcional: si el CDN no carga, queda solo el enlace) ----------------
(function renderQr() {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
  script.onload = () => {
    window.QRCode.toCanvas($('qr'), phoneUrl, { width: 380, margin: 0 }, (err) => {
      if (err) $('qrBox').hidden = true;
    });
  };
  script.onerror = () => { $('qrBox').hidden = true; };
  document.head.appendChild(script);
})();

// --- receptor ---------------------------------------------------------------
const video = $('video');
const stage = $('stage');
const setStatus = makeStatus($('dot'), $('statusText'));
let lastBytes = 0;
let lastTs = 0;

const onState = (state, message) => {
  const [label, kind] = CONNECTION_LABELS[state] || [state, 'idle'];
  setStatus(message || label, kind);
  const live = state === 'connected';
  stage.classList.toggle('live', live);
  $('btnSnap').disabled = !live;
  $('btnRec').disabled = !live;
  $('btnAudio').disabled = !live;
  if (!live) { $('stats').textContent = '—'; lastBytes = 0; }
};

const onStats = (s) => {
  const now = performance.now();
  let kbps = '';
  if (lastTs && s.bytes >= lastBytes) {
    kbps = ` · ${Math.round(((s.bytes - lastBytes) * 8) / (now - lastTs))} kbps`;
  }
  lastBytes = s.bytes;
  lastTs = now;
  $('stats').textContent =
    `${s.width}x${s.height} · ${s.fps} fps${kbps} · perdidos ${s.packetsLost}`;
};

const receiver = startReceiver({ roomId, videoEl: video, onState, onStats });

// --- controles --------------------------------------------------------------
const copy = async (input, button) => {
  input.select();
  try { await navigator.clipboard.writeText(input.value); } catch { document.execCommand('copy'); }
  const original = button.textContent;
  button.textContent = 'Copiado';
  setTimeout(() => { button.textContent = original; }, 1400);
};

$('btnCopyPhone').onclick = () => copy($('phoneUrl'), $('btnCopyPhone'));
$('btnCopyObs').onclick = () => copy($('obsUrl'), $('btnCopyObs'));

$('btnFull').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen?.();
};

$('btnAudio').onclick = () => {
  video.muted = !video.muted;
  $('btnAudio').textContent = video.muted ? 'Activar audio' : 'Silenciar';
};

$('btnSnap').onclick = () => {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob((blob) => download(blob, `captura-${stamp()}.png`), 'image/png');
};

let recorder = null;
$('btnRec').onclick = () => {
  if (recorder) {
    recorder.stop();
    return;
  }
  const chunks = [];
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(video.srcObject, { mimeType: mime });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    download(new Blob(chunks, { type: mime }), `grabacion-${stamp()}.webm`);
    recorder = null;
    $('btnRec').textContent = 'Grabar';
    $('btnRec').classList.remove('danger');
  };
  recorder.start(1000);
  $('btnRec').textContent = 'Detener grabacion';
  $('btnRec').classList.add('danger');
};

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
