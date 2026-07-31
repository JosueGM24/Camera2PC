// Configuracion ICE (STUN/TURN). Ya no hay credenciales de terceros: la
// senalizacion la hace netlify/functions/signal.mjs contra Netlify Blobs.
//
// Los valores salen de .env (local) o de las variables de entorno de Netlify a
// traves de scripts/build-config.mjs, que escribe js/env.generated.js.
//
// Ese paso es OPCIONAL: sin el se usan los STUN publicos de Google, que bastan
// cuando el telefono y la PC estan en la misma red. Solo hace falta si vas a
// configurar un TURN.

const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
  iceCandidatePoolSize: 4,
};

let generated = null;
try {
  generated = await import('./env.generated.js');
} catch {
  // No se corrio `npm run build`: seguimos con los STUN publicos.
}

export const rtcConfig = generated?.rtcConfig ?? DEFAULT_RTC_CONFIG;

export const hasTurn = rtcConfig.iceServers.some((s) =>
  [].concat(s.urls).some((u) => u.startsWith('turn:') || u.startsWith('turns:'))
);
