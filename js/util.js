// Utilidades compartidas entre las paginas.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin I, L, O, 0, 1

export function randomRoomCode(len = 6) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function normalizeRoomCode(value) {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export const params = new URLSearchParams(location.search);

export function absoluteUrl(path, query = {}) {
  const url = new URL(path, location.href);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

/** Etiqueta legible para RTCPeerConnection.connectionState */
export const CONNECTION_LABELS = {
  new: ['Inactivo', 'idle'],
  connecting: ['Conectando...', 'wait'],
  connected: ['Conectado', 'ok'],
  disconnected: ['Se perdio la senal', 'wait'],
  failed: ['Fallo la conexion', 'bad'],
  closed: ['Cerrado', 'idle'],
};

export function makeStatus(dotEl, textEl) {
  return (text, kind = 'idle') => {
    if (textEl) textEl.textContent = text;
    if (dotEl) dotEl.dataset.kind = kind;
  };
}

/** Evita que la pantalla del telefono se apague mientras transmite. */
export function createWakeLock() {
  let lock = null;
  const request = async () => {
    if (!('wakeLock' in navigator)) return false;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
      return true;
    } catch {
      return false;
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lock === null) request();
  });
  return {
    request,
    release: () => { lock?.release(); lock = null; },
  };
}

/**
 * ICE no-trickle: espera a que la conexion reuna todos sus candidatos para
 * poder publicar un unico SDP completo.
 *
 * Escucha las dos senales de fin (el cambio de estado y el candidato null)
 * porque no todos los navegadores emiten ambas de forma fiable, y corta por
 * timeout para no quedarse colgado si un TURN no responde.
 */
export function waitForIceGathering(pc, timeoutMs = 5000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve('complete');

  return new Promise((resolve) => {
    const finish = (reason) => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      pc.removeEventListener('icecandidate', onCandidate);
      resolve(reason);
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') finish('complete');
    };
    const onCandidate = (event) => {
      if (!event.candidate) finish('complete');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);

    pc.addEventListener('icegatheringstatechange', onStateChange);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

/** Sube el techo de bitrate del video para que no se vea borroso. */
export async function tuneVideoSender(sender, { maxBitrate = 2_500_000, degradation } = {}) {
  if (!sender) return;
  const p = sender.getParameters();
  p.encodings = p.encodings?.length ? p.encodings : [{}];
  p.encodings[0].maxBitrate = maxBitrate;
  if (degradation) p.degradationPreference = degradation;
  try {
    await sender.setParameters(p);
  } catch (err) {
    console.warn('No se pudo ajustar el bitrate:', err);
  }
}

export function showFatal(message) {
  const el = document.getElementById('fatal');
  if (!el) { alert(message); return; }
  el.textContent = message;
  el.hidden = false;
}
