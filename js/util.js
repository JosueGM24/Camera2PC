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

/** Etiqueta legible para RTCPeerConnection.connectionState (mas dos estados propios) */
export const CONNECTION_LABELS = {
  new: ['Inactivo', 'idle'],
  gathering: ['Reuniendo rutas de red...', 'wait'],
  waiting: ['Esperando al otro extremo...', 'wait'],
  connecting: ['Conectando...', 'wait'],
  connected: ['Conectado', 'ok'],
  disconnected: ['Se perdio la senal', 'wait'],
  failed: ['Fallo la conexion', 'bad'],
  closed: ['Cerrado', 'idle'],
};

// Subredes que asignan los anclajes por USB. Sirve para avisar de que el video
// va por el cable; es una heuristica, no una certeza.
const USB_RANGES = [
  { re: /^192\.168\.42\./, label: 'cable USB (Android)' },
  { re: /^192\.168\.43\./, label: 'anclaje Android' },
  { re: /^172\.20\.10\./, label: 'cable USB (iPhone/iPad)' },
];

/**
 * Describe por donde esta viajando el video: par de candidatos ICE elegido,
 * direcciones, tipo de ruta y RTT.
 *
 * Nota: los navegadores ofuscan sus propios candidatos host con nombres mDNS
 * (algo.local) mientras la pagina no tenga permiso de camara/microfono, asi que
 * en el receptor la direccion local puede salir como .local. La del otro
 * extremo si suele ser una IP real.
 */
export async function describeConnection(pc) {
  if (!pc) return null;
  const stats = await pc.getStats();

  const byId = new Map();
  let selectedId = null;
  let selectedPair = null;

  stats.forEach((s) => {
    if (s.type === 'local-candidate' || s.type === 'remote-candidate') byId.set(s.id, s);
    if (s.type === 'transport' && s.selectedCandidatePairId) selectedId = s.selectedCandidatePairId;
  });

  stats.forEach((s) => {
    if (s.type !== 'candidate-pair') return;
    const isSelected = s.id === selectedId || s.selected === true
      || (s.nominated && s.state === 'succeeded');
    if (isSelected && !selectedPair) selectedPair = s;
  });

  if (!selectedPair) return null;

  const local = byId.get(selectedPair.localCandidateId);
  const remote = byId.get(selectedPair.remoteCandidateId);
  const addresses = [local?.address, remote?.address].filter(Boolean);
  const usb = USB_RANGES.find((r) => addresses.some((a) => r.re.test(a)));

  return {
    local: local?.address ?? '?',
    localType: local?.candidateType ?? '?',
    remote: remote?.address ?? '?',
    remoteType: remote?.candidateType ?? '?',
    protocol: local?.protocol ?? '?',
    rttMs: selectedPair.currentRoundTripTime != null
      ? Math.round(selectedPair.currentRoundTripTime * 1000)
      : null,
    relayed: local?.candidateType === 'relay' || remote?.candidateType === 'relay',
    linkHint: usb?.label ?? null,
  };
}

/** Resumen de una linea para mostrar en la interfaz. */
export function formatConnection(info) {
  if (!info) return 'ruta: (aun sin determinar)';
  const route = info.relayed ? 'via TURN' : info.linkHint ?? 'directo';
  const rtt = info.rttMs != null ? ` · rtt ${info.rttMs} ms` : '';
  return `ruta: ${route} · ${info.local} (${info.localType}) <-> ${info.remote} (${info.remoteType}) · ${info.protocol}${rtt}`;
}

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
