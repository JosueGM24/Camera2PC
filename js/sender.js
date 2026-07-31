// Lado emisor, compartido por el telefono (camara) y la PC (pantalla).
//
// Publica la oferta completa (ICE no-trickle) y sondea la respuesta del otro
// extremo. Lo unico que cambia entre camara y pantalla es de donde sale el
// MediaStream y como se afina el encoder, asi que eso se pasa por parametro.

import { rtcConfig } from './config.js';
import { publish, fetchSignal, clearRoom, createPoller } from './signaling.js';
import { waitForIceGathering, tuneVideoSender } from './util.js';

export function createSender({ roomId, kind, onState = () => {} }) {
  let pc = null;
  let session = null;
  let poller = null;
  let stream = null;

  const closePeer = () => {
    poller?.stop();
    poller = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.close();
      pc = null;
    }
    session = null;
  };

  return {
    get peer() { return pc; },
    get stream() { return stream; },

    /**
     * Negocia una sesion nueva con el stream dado.
     * `tuning` va tal cual a tuneVideoSender (maxBitrate, degradation).
     */
    async connect(nextStream, tuning = {}) {
      closePeer();
      stream = nextStream;
      session = crypto.randomUUID();

      pc = new RTCPeerConnection(rtcConfig);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await tuneVideoSender(pc.getSenders().find((s) => s.track?.kind === 'video'), tuning);

      pc.onconnectionstatechange = () => {
        if (!pc) return;
        onState(pc.connectionState);
        if (pc.connectionState === 'connected') poller?.pause();
      };

      onState('gathering');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      await clearRoom(roomId, kind);   // descarta la sesion anterior de este flujo
      await publish(roomId, kind, 'caller', session, pc.localDescription);
      onState('waiting');

      const mySession = session;
      poller = createPoller(
        async () => {
          if (!pc || pc.currentRemoteDescription || session !== mySession) return;
          const signal = await fetchSignal(roomId, kind, 'callee');
          if (!signal?.description || signal.session !== mySession) return;
          await pc.setRemoteDescription(new RTCSessionDescription(signal.description));
          poller?.pause();
        },
        { onError: (err) => onState('failed', err.message) }
      );
      poller.start();
    },

    /** Cambia la pista de video sin renegociar (cambio de camara, p. ej.). */
    async replaceVideoTrack(track) {
      const sender = pc?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);
    },

    async stop({ clearSignal = true } = {}) {
      closePeer();
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (clearSignal) await clearRoom(roomId, kind).catch(() => {});
      onState('closed');
    },
  };
}
