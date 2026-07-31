// Buzon de senalizacion WebRTC sobre Netlify Blobs.
//
// Dos entradas por sala y por tipo de flujo, una por extremo:
//   <SALA>/<KIND>/caller  -> descripcion de quien envia el video (offer)
//   <SALA>/<KIND>/callee  -> descripcion de quien lo recibe      (answer)
//
// KIND separa los dos flujos que pueden coexistir en la misma sala:
//   cam    -> telefono envia su camara     -> PC recibe
//   screen -> PC envia su pantalla         -> tablet recibe
//
// Usamos ICE no-trickle: cada extremo espera a reunir todos sus candidatos y
// publica un solo SDP completo. Asi no hay que intercambiar candidatos uno por
// uno y cada clave tiene un unico escritor, sin condiciones de carrera.
//
// Rutas (via el redirect de netlify.toml):
//   POST   /api/signal                    { room, kind, role, session, description }
//   GET    /api/signal?room=&kind=&role=  -> 200 con el JSON, o 204 si no hay nada
//   DELETE /api/signal?room=[&kind=]      -> borra la sala (o solo ese kind)

import { getStore } from '@netlify/blobs';

const ROOM_RE = /^[A-Z0-9]{4,12}$/;
const ROLES = ['caller', 'callee'];
const KINDS = ['cam', 'screen'];
const MAX_SDP = 64 * 1024;          // un SDP real ronda los 4 KB
const TTL_MS = 10 * 60 * 1000;      // una descripcion vieja ya no sirve

const store = () => getStore({ name: 'signaling', consistency: 'strong' });
const key = (room, kind, role) => `${room}/${kind}/${role}`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });

const bad = (message, status = 400) => json({ error: message }, status);

export default async (req) => {
  const url = new URL(req.url);

  try {
    if (req.method === 'POST') return await publish(req);
    if (req.method === 'GET') return await read(url);
    if (req.method === 'DELETE') return await clear(url);
    return bad('Metodo no permitido', 405);
  } catch (err) {
    console.error('[signal]', err);
    return bad(`Error interno: ${err.message}`, 500);
  }
};

async function publish(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return bad('Cuerpo JSON invalido');
  }

  const { room, kind = 'cam', role, session, description } = body ?? {};

  if (!ROOM_RE.test(room ?? '')) return bad('Sala invalida (4-12 caracteres A-Z 0-9)');
  if (!KINDS.includes(kind)) return bad('Kind invalido');
  if (!ROLES.includes(role)) return bad('Rol invalido');
  if (typeof session !== 'string' || !session) return bad('Falta session');
  if (!description?.type || typeof description.sdp !== 'string') return bad('Falta description');
  if (description.sdp.length > MAX_SDP) return bad('SDP demasiado grande', 413);

  await store().setJSON(key(room, kind, role), {
    session,
    description: { type: description.type, sdp: description.sdp },
    at: Date.now(),
  });

  return json({ ok: true });
}

async function read(url) {
  const room = url.searchParams.get('room') ?? '';
  const kind = url.searchParams.get('kind') ?? 'cam';
  const role = url.searchParams.get('role') ?? '';

  if (!ROOM_RE.test(room)) return bad('Sala invalida');
  if (!KINDS.includes(kind)) return bad('Kind invalido');
  if (!ROLES.includes(role)) return bad('Rol invalido');

  const entry = await store().get(key(room, kind, role), { type: 'json' });
  if (!entry) return new Response(null, { status: 204 });

  // Descarta restos de sesiones abandonadas para que nadie intente conectarse
  // a un extremo que ya no existe.
  if (Date.now() - (entry.at ?? 0) > TTL_MS) {
    await store().delete(key(room, kind, role)).catch(() => {});
    return new Response(null, { status: 204 });
  }

  return json(entry);
}

async function clear(url) {
  const room = url.searchParams.get('room') ?? '';
  const kind = url.searchParams.get('kind');

  if (!ROOM_RE.test(room)) return bad('Sala invalida');
  if (kind && !KINDS.includes(kind)) return bad('Kind invalido');

  // Sin kind se limpia la sala completa; con kind solo ese flujo, para no
  // tumbar la camara cuando alguien reinicia la pantalla (o al contrario).
  const kinds = kind ? [kind] : KINDS;
  const s = store();
  await Promise.all(
    kinds.flatMap((k) => ROLES.map((role) => s.delete(key(room, k, role)).catch(() => {})))
  );
  return json({ ok: true });
}
