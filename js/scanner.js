// Lector de QR dentro de la propia pagina, para no depender de una app aparte.
//
// Usa BarcodeDetector, que es nativo del navegador: sin librerias ni descargas,
// asi que tambien funciona en el modo cable sin internet. No lo tienen todos
// los navegadores (Safari no), por eso siempre queda el codigo a mano.

/** ¿Este navegador puede leer QR sin ayuda? */
export async function qrReadable() {
  if (!('BarcodeDetector' in window)) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch {
    return false;
  }
}

/**
 * Enciende la camara trasera y busca un QR hasta encontrarlo.
 * @param {object} opts { videoEl, onCode, onError }
 */
export function createScanner({ videoEl, onCode, onError = () => {} }) {
  let stream = null;
  let detector = null;
  let timer = null;
  let running = false;

  const stop = () => {
    running = false;
    clearTimeout(timer);
    timer = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    videoEl.srcObject = null;
  };

  const tick = async () => {
    if (!running) return;
    try {
      const codes = await detector.detect(videoEl);
      const hit = codes.find((c) => c.rawValue);
      if (hit) {
        stop();
        onCode(hit.rawValue);
        return;
      }
    } catch {
      // detect() lanza si el fotograma aun no esta listo: se reintenta y ya.
    }
    // ~5 lecturas por segundo: de sobra para un QR quieto, y no calienta.
    timer = setTimeout(tick, 190);
  };

  return {
    get active() { return running; },
    stop,
    async start() {
      if (running) return;
      try {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});
        running = true;
        tick();
      } catch (err) {
        stop();
        onError(err);
      }
    },
  };
}

/**
 * Saca el codigo de sala de lo que traiga el QR: puede ser la direccion
 * completa que genera la PC, o el codigo suelto.
 */
export function roomFromScan(text) {
  if (!text) return '';
  try {
    const room = new URL(text).searchParams.get('room');
    if (room) return room;
  } catch {
    // No era una URL: se trata como codigo directo.
  }
  return text.trim();
}
