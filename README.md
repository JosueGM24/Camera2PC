# Camera2PC

La cámara de tu teléfono o tablet, en tu PC — y de ahí a Teams / Zoom / Meet como
cámara web, vía OBS.

- **Sin cuentas de terceros.** Todo vive en Netlify: el sitio estático y una función
  que hace de buzón para el saludo inicial (Netlify Blobs).
- **Sin driver propio.** El video llega al navegador por WebRTC; OBS Studio aporta la
  cámara virtual (driver ya firmado por ellos).
- **El video no pasa por ningún servidor.** Es P2P entre el teléfono y la PC. El buzón
  sólo intercambia las dos descripciones de sesión (SDP) y se queda inerte.
- **Sin framework.** HTML + JS puro (módulos ES).

## Páginas

| Página | Para qué |
|---|---|
| `index.html` | Elegir rol (detecta si estás en móvil o PC) |
| `pc.html` | **Receptor**: código de sala, QR, video, stats, foto, grabación, URL para OBS |
| `phone.html` | **Emisor**: elegir cámara / resolución y transmitir |
| `obs.html` | Receptor "limpio" (sólo video a pantalla completa) para el Browser Source de OBS |

## Cómo funciona la señalización

WebRTC conecta los dispositivos directamente, pero antes tienen que intercambiar sus
descripciones de sesión por otro canal. Aquí ese canal es una función de Netlify sobre
Netlify Blobs, con **ICE no-trickle**: cada extremo espera a reunir todos sus candidatos
de red y publica un solo SDP completo.

```
netlify/functions/signal.mjs      buzón: 2 entradas por sala
  POST   /api/signal              { room, role, session, description }
  GET    /api/signal?room=&role=   -> 200 con el JSON, o 204 si no hay nada
  DELETE /api/signal?room=         -> borra la sala
```

```
teléfono                    Netlify Blobs                    PC
   |-- POST caller (offer) ------>  <SALA>/caller
   |                                     <----- GET caller (sondeo) --|
   |                                <SALA>/callee  <-- POST callee ----|
   |-- GET callee (sondeo) ------>                                     |
   |========================= video P2P WebRTC ======================= |
```

Ventajas de este diseño: cada clave tiene **un único escritor**, así que no hay
condiciones de carrera, y no hay que intercambiar candidatos ICE uno por uno.

**Costo de invocaciones**: el sondeo empieza en 1 s, sube a 3 s tras 30 s y se queda en
5 s. Al conectar **se pausa**; se reanuda solo si la conexión se cae. Un saludo completo
gasta ~6 invocaciones de las 125.000 mensuales del plan gratuito.

## Puesta en marcha

### 1. Desplegar en Netlify

Conecta el repo. El `netlify.toml` ya define todo: publish `.`, build command,
directorio de funciones y el redirect de `/api/signal`. Netlify instala
`@netlify/blobs` solo, y **Blobs no requiere configuración** — funciona en cuanto el
sitio existe.

No hay variables de entorno obligatorias.

### 2. Probar en local

Las funciones y Blobs necesitan la CLI de Netlify (`npx serve` no sirve, porque no
levanta `/api/signal`):

```powershell
npm install
npm run dev        # = build de config + netlify dev  -> http://localhost:8888
```

`getUserMedia` sólo funciona en HTTPS o en `localhost`, así que para probar desde el
teléfono necesitas un túnel HTTPS:

```powershell
npx localtunnel --port 8888    # dale la URL https al teléfono
```

## Uso

1. En la PC abre `pc.html`. Aparece un código de sala y un QR.
2. Escanea el QR con el teléfono → se abre `phone.html` con el código ya puesto →
   **Transmitir** → acepta el permiso de cámara.
3. El video aparece en la PC en 2-4 segundos (se espera a que ICE termine de reunir).

### Como cámara web en Teams / Zoom / Meet

1. En `pc.html`, copia la **URL para OBS**.
2. OBS Studio → **Fuentes → + → Navegador** → pega la URL, ancho `1920`, alto `1080`,
   FPS `30`. Marca *Controlar audio mediante OBS* si también quieres el micrófono del
   teléfono.
3. Click derecho en la fuente → **Cambiar a pantalla completa**.
4. **Iniciar cámara virtual** (botón en el panel de Controles).
5. En Teams / Zoom / Meet, elige la cámara **OBS Virtual Camera**.

La URL de OBS no cambia: el código de sala se guarda en `localStorage`, así que una vez
configurada la fuente puedes olvidarte de ella.

Parámetros de `obs.html`:

- `?room=ABC123` — sala (obligatorio si es la primera vez en ese navegador).
- `&fit=contain` — no recortar el video (por defecto usa `cover` para llenar el lienzo).
- `&muted=1` — forzar silencio.

## Configuración opcional (TURN)

Sólo hace falta si el teléfono y la PC van a estar en **redes distintas** (datos móviles
↔ oficina) o detrás de NAT simétrico. En la misma Wi-Fi los STUN públicos bastan.

```powershell
copy .env.example .env    # descomenta y llena TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL
npm run build             # regenera js/env.generated.js
```

En Netlify, las mismas claves en **Site configuration → Environment variables**.

| Variable | Nota |
|---|---|
| `STUN_URLS` | Opcional. Por defecto, los de Google. Separa varios con coma. |
| `TURN_URLS` | Opcional. Si la defines, el build exige usuario y password. |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | Credenciales del TURN (Metered, Twilio, `coturn`). |

`js/env.generated.js` está en `.gitignore` y lo escribe el build; no lo edites a mano.
Si no corres el build, `js/config.js` cae a los STUN de Google — la app funciona igual.

> Ojo: cualquier valor aquí termina en el JavaScript del navegador, o sea que es
> **público**. `.env` sirve para mantenerlo fuera del repo, no para hacerlo secreto.
> Si usas TURN, usa credenciales efímeras.

## Detalles que conviene saber

- **iOS / Safari**: la cámara sólo funciona en HTTPS y no funciona dentro de navegadores
  embebidos (Instagram, Facebook, etc.). Abre el enlace en Safari o Chrome.
- **Pantalla del teléfono**: se usa la Screen Wake Lock API para que no se apague
  (Chrome Android, Safari 16.4+). Si el navegador no la soporta, deja la pestaña al frente.
- **Latencia** típica: 100-300 ms en LAN. El *saludo* tarda 2-4 s por el ICE no-trickle;
  la latencia del video no se ve afectada.
- **Bitrate**: se fija según la resolución (4 Mbps en 1080p, 2.5 en 720p). Ajústalo en
  `BITRATE` dentro de `js/phone.js`.
- **Prioridad "Detalle"** pone `contentHint = 'detail'` y
  `degradationPreference = 'maintain-resolution'`: útil para leer documentos o códigos,
  a costa de fluidez.
- **Reconexión**: si la conexión se cae, el receptor vuelve a sondear solo. Basta con
  pulsar **Transmitir** otra vez en el teléfono. En la PC, **Reiniciar sesión** limpia el
  buzón y vuelve a esperar.
- **Limpieza**: al detener la transmisión se borra la sala. Las entradas abandonadas
  caducan solas a los 10 minutos (`TTL_MS` en la función).
- **Sala**: 4-12 caracteres `A-Z 0-9`, validado en cliente y en servidor. El código es el
  secreto compartido: sin él nadie sabe a qué sala entrar.

## Lo que esto NO puede hacer

Una web app no puede registrar un dispositivo de cámara en Windows — está en un sandbox.
Por eso la cámara virtual la da OBS. Alternativas ya empaquetadas si no quieres OBS:
Camo, Iriun Webcam, DroidCam (todas instalan su propio driver).
