// Cliente del buzon de senalizacion (netlify/functions/signal.mjs).
//
// No hay push: se consulta por HTTP. El saludo dura un par de segundos, asi que
// se sondea rapido al principio y luego se va relajando el intervalo para no
// gastar invocaciones cuando nadie esta conectando.

const API = '/api/signal';

export async function publish(room, role, session, description) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      room,
      role,
      session,
      description: { type: description.type, sdp: description.sdp },
    }),
  });
  if (!res.ok) throw new Error(await describeError(res));
  return res.json();
}

/** Devuelve { session, description, at } o null si el otro extremo no publico. */
export async function fetchSignal(room, role) {
  const res = await fetch(`${API}?room=${encodeURIComponent(room)}&role=${role}`, {
    cache: 'no-store',
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(await describeError(res));
  return res.json();
}

export async function clearRoom(room) {
  const res = await fetch(`${API}?room=${encodeURIComponent(room)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await describeError(res));
}

/**
 * Version para 'pagehide': `keepalive` deja que la peticion sobreviva al cierre
 * de la pestana. Es best-effort; si falla, el TTL del buzon limpia igual.
 */
export function clearRoomOnUnload(room) {
  try {
    fetch(`${API}?room=${encodeURIComponent(room)}`, { method: 'DELETE', keepalive: true });
  } catch { /* la pagina ya se esta yendo */ }
}

async function describeError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error ? ` - ${body.error}` : '';
  } catch { /* respuesta sin JSON */ }
  return `Senalizacion HTTP ${res.status}${detail}`;
}

/**
 * Sondeo con intervalo creciente: 1 s durante los primeros 30 s,
 * 3 s hasta los 2 min, y 5 s a partir de ahi.
 *
 * start() tambien hace de resume y reinicia el intervalo al mas rapido, que es
 * justo lo que quieres despues de una desconexion.
 */
export function createPoller(task, { onError } = {}) {
  let timer = null;      // != null  <=>  esperando; null <=> tarea en vuelo
  let running = false;   // pausado = la cadena sigue viva pero no llama a task()
  let disposed = false;
  let startedAt = 0;

  const delay = () => {
    if (!running) return 500;
    const elapsed = Date.now() - startedAt;
    if (elapsed < 30_000) return 1000;
    if (elapsed < 120_000) return 3000;
    return 5000;
  };

  // Una sola cadena de por vida: no hay forma de duplicarla ni de matarla por
  // accidente al pausar y reanudar.
  const loop = async () => {
    timer = null;
    if (disposed) return;
    if (running) {
      try {
        await task();
      } catch (err) {
        onError?.(err);
      }
    }
    if (!disposed) timer = setTimeout(loop, delay());
  };

  timer = setTimeout(loop, 0);

  return {
    start() {
      if (disposed) return;
      running = true;
      startedAt = Date.now();
      // Si hay una espera pendiente, adelantala. Si timer es null hay una tarea
      // en vuelo y esa misma reprogramara con el ritmo nuevo.
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        loop();
      }
    },
    pause() { running = false; },
    stop() {
      disposed = true;
      running = false;
      clearTimeout(timer);
      timer = null;
    },
    get active() { return running; },
  };
}
