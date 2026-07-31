import { rtcConfig } from './config.js';
import { publish, fetchSignal, clearRoom, clearRoomOnUnload, createPoller } from './signaling.js';
import {
  params, normalizeRoomCode, CONNECTION_LABELS, makeStatus,
  createWakeLock, tuneVideoSender, waitForIceGathering, showFatal,
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

let stream = null;
let pc = null;
let session = null;
let roomId = null;
let facing = 'environment';
let answerPoller = null;

// --- camara -----------------------------------------------------------------
async function openCamera() {
  const [width, height] = $('resolution').value.split('x').map(Number);
  const next = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: {
      facingMode: { ideal: facing },
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30 },
    },
  });

  const track = next.getVideoTracks()[0];
  track.contentHint = $('mode').value === 'detail' ? 'detail' : 'motion';

  stream?.getTracks().forEach((t) => t.stop());
  stream = next;
  $('preview').srcObject = stream;
  $('stage').classList.add('live');

  const torchable = !!track.getCapabilities?.().torch;
  $('btnTorch').hidden = !torchable;
  $('btnTorch').disabled = !torchable;

  return track;
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

  try {
    await openCamera();
  } catch (err) {
    setStatus(`No se pudo abrir la camara: ${err.name}`, 'bad');
    $('btnStart').disabled = false;
    return;
  }

  session = crypto.randomUUID();
  pc = new RTCPeerConnection(rtcConfig);
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  await tuneVideoSender(pc.getSenders().find((s) => s.track?.kind === 'video'), {
    maxBitrate: BITRATE[$('resolution').value] || 2_500_000,
    degradation: $('mode').value === 'detail' ? 'maintain-resolution' : 'maintain-framerate',
  });

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    const [label, kind] = CONNECTION_LABELS[pc.connectionState] || [pc.connectionState, 'idle'];
    setStatus(label, kind);
    if (pc.connectionState === 'connected') {
      answerPoller?.pause();
      wakeLock.request().then((ok) => {
        $('tip').textContent = ok
          ? 'Transmitiendo. La pantalla se mantendra encendida.'
          : 'Transmitiendo. Deja la pantalla encendida y esta pestana al frente.';
      });
    }
  };

  setStatus('Reuniendo rutas de red...', 'wait');
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

  try {
    await clearRoom(roomId);                                  // descarta la sesion anterior
    await publish(roomId, 'caller', session, pc.localDescription);
  } catch (err) {
    setStatus(err.message, 'bad');
    await stop();
    return;
  }

  setStatus('Esperando a la PC...', 'wait');

  answerPoller = createPoller(
    async () => {
      if (!pc || pc.currentRemoteDescription) return;
      const signal = await fetchSignal(roomId, 'callee');
      if (!signal?.description || signal.session !== session) return;
      await pc.setRemoteDescription(new RTCSessionDescription(signal.description));
      answerPoller.pause();
    },
    { onError: (err) => setStatus(err.message, 'bad') }
  );
  answerPoller.start();

  $('btnStop').disabled = false;
  $('btnSwitch').disabled = false;
  $('resolution').disabled = true;
  $('mode').disabled = true;
}

async function stop() {
  answerPoller?.stop();
  answerPoller = null;
  if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = null; }
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  session = null;
  $('preview').srcObject = null;
  $('stage').classList.remove('live');
  wakeLock.release();
  if (roomId) await clearRoom(roomId).catch(() => {});
  setStatus('Detenido');
  $('tip').textContent = '';
  $('btnStart').disabled = false;
  $('btnStop').disabled = true;
  $('btnSwitch').disabled = true;
  $('btnTorch').disabled = true;
  $('resolution').disabled = false;
  $('mode').disabled = false;
}

/** Cambia de camara sin renegociar: reemplaza la pista en el sender. */
async function useCamera(nextFacing) {
  facing = nextFacing;
  $('camera').value = facing;
  $('btnSwitch').disabled = true;
  try {
    const track = await openCamera();
    const sender = pc?.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(track);
  } catch (err) {
    setStatus(`No se pudo cambiar de camara: ${err.name}`, 'bad');
  }
  $('btnSwitch').disabled = !pc;
}

// --- eventos ----------------------------------------------------------------
$('camera').addEventListener('change', (e) => {
  if (stream) useCamera(e.target.value);
  else facing = e.target.value;
});

$('btnStart').onclick = () => start().catch((err) => setStatus(`Error: ${err.message}`, 'bad'));
$('btnStop').onclick = () => stop();
$('btnSwitch').onclick = () => useCamera(facing === 'environment' ? 'user' : 'environment');

let torchOn = false;
$('btnTorch').onclick = async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    $('btnTorch').textContent = torchOn ? 'Apagar linterna' : 'Linterna';
  } catch {
    $('btnTorch').disabled = true;
  }
};

// Al cerrar la pestana, libera la sala para que la PC no vea una oferta muerta.
window.addEventListener('pagehide', () => {
  if (roomId && pc) clearRoomOnUnload(roomId);
});

setStatus('Listo');
