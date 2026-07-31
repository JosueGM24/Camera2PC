// Lado PC: captura la pantalla y la envia a la tablet.
//
// El flujo es identico al del telefono pero al reves (aqui la PC es el emisor),
// asi que reutiliza js/sender.js con kind = 'screen'.

import { KIND_SCREEN, clearRoomOnUnload } from './signaling.js';
import { createSender } from './sender.js';
import { createLink, paintIcons, rememberFolds, flashConfirm } from './ui.js';
import { listDisplays, formatDisplays } from './displays.js';
import {
  params, randomRoomCode, normalizeRoomCode, absoluteUrl,
  CONNECTION_LABELS, makeStatus, describeConnection, formatConnection, showFatal,
} from './util.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'camera2pc.room';

paintIcons();
rememberFolds();

if (!navigator.mediaDevices?.getDisplayMedia) {
  showFatal('Este navegador no puede capturar la pantalla. Usa Chrome, Edge o Firefox de escritorio.');
}

// --- sala (compartida con el flujo de camara) --------------------------------
const roomId =
  normalizeRoomCode(params.get('room')) ||
  normalizeRoomCode(localStorage.getItem(STORE_KEY)) ||
  randomRoomCode();
localStorage.setItem(STORE_KEY, roomId);

const viewUrl = absoluteUrl('/view', { room: roomId });
$('code').textContent = roomId;
$('viewUrl').value = viewUrl;

(function renderQr() {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
  script.onload = () => {
    window.QRCode.toCanvas($('qr'), viewUrl,
      { width: 360, margin: 0, color: { dark: '#1e1f23', light: '#ffffff' } },
      (err) => { if (err) $('qrBox').hidden = true; });
  };
  script.onerror = () => { $('qrBox').hidden = true; };
  document.head.appendChild(script);
})();

// --- estado -----------------------------------------------------------------
const setStatus = makeStatus($('dot'), $('statusText'));
const link = createLink($('link'), {
  from: 'pc', to: 'tablet', fromLabel: 'Esta PC', toLabel: 'Tablet',
});
let sender = null;
let routeTimer = null;

const onState = (state, message) => {
  const [label, kind] = CONNECTION_LABELS[state] || [state, 'idle'];
  setStatus(message || label, kind);
  link.setState(state);
  if (state === 'connected') startRouteWatch();
};

function startRouteWatch() {
  clearInterval(routeTimer);
  const tick = async () => {
    const info = await describeConnection(sender?.peer).catch(() => null);
    if (!info) return;
    link.setState('connected', info);
    $('route').textContent = formatConnection(info);
  };
  tick();
  routeTimer = setInterval(tick, 3000);
}

// --- captura ----------------------------------------------------------------
async function start() {
  $('btnStart').disabled = true;
  setStatus('Elige que compartir...', 'wait');

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: Number($('fps').value) } },
      audio: $('audio').value === 'si',
    });
  } catch (err) {
    // NotAllowedError = el usuario cerro el selector, no es un fallo real.
    setStatus(err.name === 'NotAllowedError' ? 'Cancelado' : `No se pudo capturar: ${err.name}`,
      err.name === 'NotAllowedError' ? 'idle' : 'bad');
    $('btnStart').disabled = false;
    return;
  }

  const track = stream.getVideoTracks()[0];
  // 'text' hace que el encoder priorice nitidez sobre fluidez: se nota mucho
  // leyendo codigo o documentos en la tablet.
  track.contentHint = $('mode').value === 'text' ? 'text' : 'motion';

  // Si el usuario para la captura desde la barra del navegador, cerramos todo.
  track.addEventListener('ended', () => { stop(); });

  $('preview').srcObject = stream;
  $('stage').classList.add('live');

  sender = createSender({ roomId, kind: KIND_SCREEN, onState });

  try {
    await sender.connect(stream, {
      maxBitrate: Number($('bitrate').value),
      degradation: $('mode').value === 'text' ? 'maintain-resolution' : 'maintain-framerate',
    });
  } catch (err) {
    setStatus(err.message, 'bad');
    await stop();
    return;
  }

  $('btnStop').disabled = false;
  $('mode').disabled = true;
  $('bitrate').disabled = true;
  $('fps').disabled = true;
  $('audio').disabled = true;
}

async function stop() {
  clearInterval(routeTimer);
  routeTimer = null;
  await sender?.stop();
  sender = null;
  $('preview').srcObject = null;
  $('stage').classList.remove('live');
  $('route').textContent = '';
  setStatus('Detenido');
  link.setState('closed');
  $('btnStart').disabled = false;
  $('btnStop').disabled = true;
  $('mode').disabled = false;
  $('bitrate').disabled = false;
  $('fps').disabled = false;
  $('audio').disabled = false;
}

$('btnStart').onclick = () => start().catch((err) => setStatus(`Error: ${err.message}`, 'bad'));
$('btnStop').onclick = () => stop();

$('btnCopy').onclick = async () => {
  $('viewUrl').select();
  try { await navigator.clipboard.writeText(viewUrl); } catch { document.execCommand('copy'); }
  flashConfirm($('btnCopy'));
};

// --- configuracion del monitor virtual: prominente hasta que este hecha -----
const SETUP_KEY = 'camera2pc.displayReady';
const setup = $('setup');
const markSetup = (done) => {
  setup.dataset.done = done ? '1' : '0';
  try { localStorage.setItem(SETUP_KEY, done ? '1' : '0'); } catch { /* modo privado */ }
};
markSetup(localStorage.getItem(SETUP_KEY) === '1');
$('btnSetupDone').onclick = () => markSetup(true);
$('btnSetupAgain').onclick = () => markSetup(false);

// Comprobar los monitores que ve Windows: el paso del driver virtual deja de
// hacerse a ciegas. No podemos crear una pantalla, pero si mirarlas.
$('btnDetect').onclick = async () => {
  const out = $('displays');
  out.textContent = 'Consultando...';
  try {
    out.textContent = formatDisplays(await listDisplays());
  } catch (err) {
    out.textContent = err.code === 'unsupported'
      ? 'Este navegador no puede leer la lista de monitores. Usa Chrome o Edge de escritorio; la lista tambien sale en Configuracion > Pantalla de Windows.'
      : 'Hace falta dar permiso de gestion de ventanas. Vuelve a pulsar y acepta el aviso del navegador.';
  }
};

window.addEventListener('pagehide', () => {
  if (sender) clearRoomOnUnload(roomId, KIND_SCREEN);
});

setStatus('Listo');
