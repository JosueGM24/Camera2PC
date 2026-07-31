import { KIND_CAM, clearRoomOnUnload } from './signaling.js';
import { createSender } from './sender.js';
import {
  params, normalizeRoomCode, CONNECTION_LABELS, makeStatus,
  createWakeLock, describeConnection, formatConnection, showFatal,
} from './util.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'camera2pc.room';

if (!navigator.mediaDevices?.getUserMedia) {
  showFatal('Este navegador no permite acceder a la camara. Abre la pagina en Chrome o Safari, no dentro de otra app.');
}

const setStatus = makeStatus($('dot'), $('statusText'));
const wakeLock = createWakeLock();

$('room').value =
  normalizeRoomCode(params.get('room')) ||
  normalizeRoomCode(localStorage.getItem(STORE_KEY)) || '';
$('room').addEventListener('input', (e) => {
  e.target.value = normalizeRoomCode(e.target.value);
});

const BITRATE = { '1920x1080': 4_000_000, '1280x720': 2_500_000, '640x480': 1_000_000 };

let sender = null;
let roomId = null;
let facing = 'environment';
let routeTimer = null;

// --- camara -----------------------------------------------------------------
async function openCamera() {
  const [width, height] = $('resolution').value.split('x').map(Number);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: {
      facingMode: { ideal: facing },
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30 },
    },
  });

  const track = stream.getVideoTracks()[0];
  track.contentHint = $('mode').value === 'detail' ? 'detail' : 'motion';

  $('preview').srcObject = stream;
  $('stage').classList.add('live');

  const torchable = !!track.getCapabilities?.().torch;
  $('btnTorch').hidden = !torchable;
  $('btnTorch').disabled = !torchable;

  return stream;
}

const tuning = () => ({
  maxBitrate: BITRATE[$('resolution').value] || 2_500_000,
  degradation: $('mode').value === 'detail' ? 'maintain-resolution' : 'maintain-framerate',
});

// --- estado -----------------------------------------------------------------
const onState = (state, message) => {
  const [label, kind] = CONNECTION_LABELS[state] || [state, 'idle'];
  setStatus(message || label, kind);

  if (state === 'connected') {
    wakeLock.request().then((ok) => {
      $('tip').textContent = ok
        ? 'Transmitiendo. La pantalla se mantendra encendida.'
        : 'Transmitiendo. Deja la pantalla encendida y esta pestana al frente.';
    });
    startRouteWatch();
  }
};

function startRouteWatch() {
  clearInterval(routeTimer);
  const tick = async () => {
    const info = await describeConnection(sender?.peer).catch(() => null);
    if (info) $('route').textContent = formatConnection(info);
  };
  tick();
  routeTimer = setInterval(tick, 3000);
}

// --- transmision ------------------------------------------------------------
async function start() {
  roomId = normalizeRoomCode($('room').value);
  if (roomId.length < 4) {
    setStatus('Escribe el codigo que aparece en la PC', 'bad');
    return;
  }
  localStorage.setItem(STORE_KEY, roomId);

  $('btnStart').disabled = true;
  setStatus('Abriendo la camara...', 'wait');

  let stream;
  try {
    stream = await openCamera();
  } catch (err) {
    setStatus(`No se pudo abrir la camara: ${err.name}`, 'bad');
    $('btnStart').disabled = false;
    return;
  }

  sender = createSender({ roomId, kind: KIND_CAM, onState });

  try {
    await sender.connect(stream, tuning());
  } catch (err) {
    setStatus(err.message, 'bad');
    await stop();
    return;
  }

  $('btnStop').disabled = false;
  $('btnSwitch').disabled = false;
  $('resolution').disabled = true;
  $('mode').disabled = true;
}

async function stop() {
  clearInterval(routeTimer);
  routeTimer = null;
  await sender?.stop();
  sender = null;
  $('preview').srcObject = null;
  $('stage').classList.remove('live');
  wakeLock.release();
  setStatus('Detenido');
  $('tip').textContent = '';
  $('route').textContent = '';
  $('btnStart').disabled = false;
  $('btnStop').disabled = true;
  $('btnSwitch').disabled = true;
  $('btnTorch').disabled = true;
  $('resolution').disabled = false;
  $('mode').disabled = false;
}

/** Cambia de camara sin renegociar: reemplaza la pista en el sender. */
async function useCamera(nextFacing) {
  const previous = facing;
  facing = nextFacing;
  $('camera').value = facing;
  $('btnSwitch').disabled = true;
  try {
    const old = $('preview').srcObject;
    const stream = await openCamera();
    await sender?.replaceVideoTrack(stream.getVideoTracks()[0]);
    old?.getTracks().forEach((t) => t.stop());
  } catch (err) {
    facing = previous;
    $('camera').value = facing;
    setStatus(`No se pudo cambiar de camara: ${err.name}`, 'bad');
  }
  $('btnSwitch').disabled = !sender;
}

// --- eventos ----------------------------------------------------------------
$('camera').addEventListener('change', (e) => {
  if (sender) useCamera(e.target.value);
  else facing = e.target.value;
});

$('btnStart').onclick = () => start().catch((err) => setStatus(`Error: ${err.message}`, 'bad'));
$('btnStop').onclick = () => stop();
$('btnSwitch').onclick = () => useCamera(facing === 'environment' ? 'user' : 'environment');

let torchOn = false;
$('btnTorch').onclick = async () => {
  const track = $('preview').srcObject?.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    $('btnTorch').textContent = torchOn ? 'Apagar linterna' : 'Linterna';
  } catch {
    $('btnTorch').disabled = true;
  }
};

// Al cerrar la pestana, libera el flujo de camara para que la PC no vea una
// oferta muerta. No toca el flujo de pantalla de la misma sala.
window.addEventListener('pagehide', () => {
  if (roomId && sender) clearRoomOnUnload(roomId, KIND_CAM);
});

setStatus('Listo');
