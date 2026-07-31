// Lado PC: recibe el video del telefono. Lo usan pc.html y obs.html.
//
// Sondea el buzon esperando la oferta del telefono. Cada transmision del
// telefono trae un `session` distinto: al ver uno nuevo se tira la conexion
// anterior y se renegocia. Al conectar, el sondeo se pausa (no gasta
// invocaciones) y se reanuda solo si la conexion se cae.

import { rtcConfig } from './config.js';
import { publish, fetchSignal, createPoller } from './signaling.js';
import { waitForIceGathering } from './util.js';

export function startReceiver({ roomId, videoEl, onState = () => {}, onStats = null }) {
  let pc = null;
  let session = null;
  let statsTimer = null;
  let stopped = false;

  const teardownPeer = () => {
    if (!pc) return;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
    pc = null;
  };

  const answerSession = async (signal) => {
    teardownPeer();
    session = signal.session;
    onState('connecting', 'Negociando con el telefono...');

    pc = new RTCPeerConnection(rtcConfig);

    pc.ontrack = (event) => {
      if (videoEl.srcObject !== event.streams[0]) {
        videoEl.srcObject = event.streams[0];
        videoEl.play().catch(() => {}); // autoplay bloqueado: queda el poster
      }
    };

    pc.onconnectionstatechange = () => {
      if (!pc || stopped) return;
      const state = pc.connectionState;
      onState(state);
      if (state === 'connected') {
        poller.pause();
      } else if (state === 'disconnected' || state === 'failed') {
        // Vuelve a escuchar: cuando el telefono pulse Transmitir publicara una
        // sesion nueva y la conexion se rearma sola.
        poller.start();
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(signal.description));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);
    await publish(roomId, 'callee', session, pc.localDescription);
  };

  const poller = createPoller(
    async () => {
      const signal = await fetchSignal(roomId, 'caller');
      if (!signal?.description) {
        if (!session) onState('new', 'Esperando al telefono...');
        return;
      }
      if (signal.session === session) return; // ya la contestamos
      await answerSession(signal);
    },
    { onError: (err) => onState('failed', err.message) }
  );

  if (onStats) {
    statsTimer = setInterval(async () => {
      if (!pc || pc.connectionState !== 'connected') return;
      const report = await pc.getStats();
      let inbound = null;
      report.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s;
      });
      if (inbound) {
        onStats({
          width: videoEl.videoWidth,
          height: videoEl.videoHeight,
          fps: Math.round(inbound.framesPerSecond || 0),
          bytes: inbound.bytesReceived,
          packetsLost: inbound.packetsLost || 0,
          jitter: inbound.jitter,
        });
      }
    }, 1000);
  }

  // Al volver a la pestana, sondea rapido otra vez si aun no hay conexion.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !stopped && pc?.connectionState !== 'connected') {
      poller.start();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  onState('new', 'Esperando al telefono...');
  poller.start();

  return {
    get peer() { return pc; },
    /** Olvida la sesion actual para volver a aceptar la oferta que haya en el buzon. */
    rearm() {
      teardownPeer();
      session = null;
      videoEl.srcObject = null;
      onState('new', 'Esperando al telefono...');
      poller.start();
    },
    stop() {
      stopped = true;
      clearInterval(statsTimer);
      document.removeEventListener('visibilitychange', onVisible);
      poller.stop();
      teardownPeer();
      videoEl.srcObject = null;
      onState('closed');
    },
  };
}
