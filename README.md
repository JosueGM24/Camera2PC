# Camera2PC

La cámara de tu teléfono o tablet en tu PC, y la pantalla de la PC en tu tablet.
Por Wi-Fi o **por cable USB**.

- **Sin cuentas de terceros.** Todo vive en Netlify: el sitio estático y una función
  que hace de buzón para el saludo inicial (Netlify Blobs).
- **Sin driver propio.** El video llega al navegador por WebRTC; OBS Studio aporta la
  cámara virtual (driver ya firmado por ellos).
- **El video no pasa por ningún servidor.** Es P2P entre los dos dispositivos.
- **Sin framework.** HTML + JS puro (módulos ES).

## Páginas

| Página | Dónde se abre | Para qué |
|---|---|---|
| `index.html` | cualquiera | Elegir rol (detecta si estás en móvil o PC) |
| `pc.html` | PC | **Recibe la cámara**: código de sala, QR, stats, foto, grabación, URL para OBS |
| `phone.html` | teléfono | **Envía la cámara**: elegir cámara, resolución, linterna |
| `obs.html` | PC (dentro de OBS) | Receptor "limpio" para el Browser Source |
| `screen.html` | PC | **Envía la pantalla** a la tablet (segundo monitor) |
| `view.html` | tablet | **Recibe la pantalla**, sin recortar, sin apagarse |

Los dos flujos (`cam` y `screen`) comparten el mismo código de sala y conviven sin
estorbarse: puedes tener la cámara del teléfono en la PC y la pantalla de la PC en la
tablet a la vez.

---

## Conectar por cable USB

El truco no es el USB en sí, sino conseguir un **enlace IP por el cable**. El anclaje
por USB hace exactamente eso: PC y teléfono quedan en la misma subred y WebRTC elige esa
ruta él solo. Menos latencia, sin saturar el Wi-Fi, y el teléfono se carga.

### Camino simple (Android e iOS, cero instalación)

1. Conecta el cable.
2. Activa el anclaje:
   - **Android**: Ajustes → Conexiones → Zona Wi-Fi y anclaje → **Anclaje por USB**.
   - **iPhone / iPad**: Ajustes → **Compartir Internet** → activado (con el cable puesto).
3. Abre las páginas como siempre, con la URL de Netlify.
4. Mira el panel de estado: muestra la **ruta elegida**. Si dice `cable USB`, el video va
   por el cable.
5. Si quieres forzarlo, apaga el Wi-Fi del teléfono.

Las subredes que delatan el cable son `192.168.42.x` (Android) y `172.20.10.x` (iOS); de
ahí sale la etiqueta. Es una heurística, no una certeza.

> Los navegadores ofuscan sus propios candidatos ICE con nombres mDNS (`algo.local`)
> mientras la página no tenga permiso de cámara. Por eso en el receptor la dirección
> local puede salir como `.local` mientras la del teléfono sí es una IP real.

### Camino sin internet (Android)

Si el teléfono no tiene datos, Netlify es inalcanzable. Entonces se corre todo en local:

```powershell
npm run local     # servidor local: estáticos + /api/signal en memoria
npm run usb       # comprueba adb, redirige el puerto y verifica el anclaje
```

Luego, en la PC `http://localhost:8888/pc.html`, y en el teléfono
`http://localhost:8888/phone.html`.

**Por qué `localhost` en el teléfono:** `getUserMedia` exige un origen seguro.
`http://localhost` **sí** lo es; `http://192.168.x.x` **no**. Con `adb reverse` el
teléfono alcanza el servidor de la PC a través de su propio `localhost`, así que la
cámara funciona sin certificados. El video no pasa por ese servidor: va directo por el
enlace del anclaje USB.

Requisitos: `adb` en el PATH (`winget install Google.PlatformTools`) y **Depuración USB**
activada en el teléfono. En iOS no hay `adb`, así que ahí usa el camino simple (el
anclaje ya da internet además del enlace).

`scripts/local-server.mjs` implementa el **mismo contrato** que la función de Netlify, así
que el frontend no cambia una sola línea entre los dos modos.

---

## Segundo monitor

`screen.html` captura la pantalla de la PC con `getDisplayMedia()` y la envía a la tablet.
Puedes elegir un monitor completo, una ventana suelta o una pestaña.

Opciones: prioridad **texto nítido** (`contentHint = 'text'` +
`maintain-resolution`, para leer código o documentos) o **movimiento fluido**; bitrate
hasta 12 Mbps; 15/30/60 fps; y audio del sistema opcional.

En la tablet, `view.html` va a pantalla completa, no recorta la imagen, mantiene la
pantalla encendida con Wake Lock y esconde su barra de botones a los 3 segundos.

### El límite, sin rodeos

Esto es un **monitor espejo**, no un escritorio extendido. Windows no ve la tablet como
pantalla, así que **no puedes arrastrar ventanas ahí**. Tampoco hay entrada: tocar la
tablet no controla la PC. Con 100-300 ms de latencia sirve muy bien para documentación,
chat, dashboards o monitoreo; no para dibujar ni jugar.

### Cómo convertirlo en monitor extendido de verdad

Mismo patrón que la cámara virtual con OBS: un driver ya hecho aporta lo que el navegador
no puede, y nosotros ponemos el transporte.

1. Instala un **driver de pantalla virtual** (IddCx). El más usado es
   [Virtual Display Driver](https://github.com/itsmikethetech/Virtual-Display-Driver),
   gratuito y de código abierto.
2. Windows te muestra un monitor extra real en Configuración → Pantalla. Ya puedes
   arrastrar ventanas ahí y ajustar su resolución a la de tu tablet.
3. En `screen.html`, al compartir elige **ese** monitor.
4. La tablet muestra un escritorio extendido auténtico.

Sigue sin haber entrada táctil de vuelta. Si lo que quieres es exactamente eso —
escritorio extendido con touch — la herramienta hecha para ello es **spacedesk**
(gratuita, driver en Windows + app en la tablet). Nuestra ventaja es que no instalas nada
en la tablet y funciona en iPad y Android igual.

---

## Cómo funciona la señalización

WebRTC conecta los dispositivos directamente, pero antes tienen que intercambiar sus
descripciones de sesión por otro canal. Aquí es una función de Netlify sobre Netlify
Blobs, con **ICE no-trickle**: cada extremo espera a reunir todos sus candidatos de red y
publica un solo SDP completo.

```
netlify/functions/signal.mjs        buzón: 2 entradas por sala y por kind
  POST   /api/signal                { room, kind, role, session, description }
  GET    /api/signal?room=&kind=&role=  -> 200 con el JSON, o 204 si no hay nada
  DELETE /api/signal?room=[&kind=]      -> borra la sala (o sólo ese flujo)
```

```
  kind=cam                                        kind=screen
  teléfono --offer-->  <SALA>/cam/caller          PC --offer-->  <SALA>/screen/caller
  PC       --answer--> <SALA>/cam/callee          tablet --answer--> <SALA>/screen/callee
  |=========== video P2P ===========|             |=========== video P2P ===========|
```

Cada clave tiene **un único escritor**, así que no hay condiciones de carrera, y no hay
que intercambiar candidatos ICE uno por uno.

**Costo de invocaciones**: el sondeo empieza en 1 s, sube a 3 s tras 30 s y se queda en
5 s. Al conectar **se pausa**; se reanuda sólo si la conexión se cae. Un saludo completo
gasta ~6 invocaciones de las 125.000 mensuales del plan gratuito.

## Puesta en marcha

### Desplegar en Netlify

Conecta el repo. El `netlify.toml` ya define todo: publish `.`, build command, directorio
de funciones y el redirect de `/api/signal`. Netlify instala `@netlify/blobs` solo, y
**Blobs no requiere configuración**. No hay variables de entorno obligatorias.

### Probar en local

| Comando | Para qué |
|---|---|
| `npm run dev` | Netlify CLI: funciones + Blobs reales, en `http://localhost:8888` |
| `npm run local` | Servidor propio sin dependencias, para el modo cable sin internet |
| `npm run usb` | Prepara `adb reverse` y verifica el anclaje por USB |
| `npm run build` | Regenera `js/env.generated.js` (sólo hace falta si usas TURN) |

`getUserMedia` sólo funciona en HTTPS o en `localhost`. Para probar desde el teléfono por
Wi-Fi necesitas un túnel HTTPS: `npx localtunnel --port 8888`.

## Uso de la cámara

1. En la PC abre `pc.html`. Aparece un código de sala y un QR.
2. Escanea el QR con el teléfono → **Transmitir** → acepta el permiso de cámara.
3. El video aparece en 2-4 segundos (se espera a que ICE termine de reunir).

### Como cámara web en Teams / Zoom / Meet

1. En `pc.html`, copia la **URL para OBS**.
2. OBS Studio → **Fuentes → + → Navegador** → pega la URL, ancho `1920`, alto `1080`,
   FPS `30`. Marca *Controlar audio mediante OBS* si quieres el micrófono del teléfono.
3. Click derecho en la fuente → **Cambiar a pantalla completa**.
4. **Iniciar cámara virtual** (panel de Controles).
5. En Teams / Zoom / Meet elige **OBS Virtual Camera**.

La URL de OBS no cambia: el código de sala se guarda en `localStorage`.

Parámetros de `obs.html`: `?room=ABC123`, `&fit=contain` (no recortar), `&muted=1`.

## Configuración opcional (TURN)

Sólo hace falta si los dispositivos van a estar en **redes distintas** o detrás de NAT
simétrico. Con cable o en la misma Wi-Fi, los STUN públicos bastan.

```powershell
copy .env.example .env    # llena TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL
npm run build
```

En Netlify, las mismas claves en **Site configuration → Environment variables**.

| Variable | Nota |
|---|---|
| `STUN_URLS` | Opcional. Por defecto, los de Google. Separa varios con coma. |
| `TURN_URLS` | Opcional. Si la defines, el build exige usuario y password. |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | Credenciales del TURN (Metered, Twilio, `coturn`). |

> Cualquier valor aquí termina en el JavaScript del navegador, o sea que es **público**.
> `.env` sirve para mantenerlo fuera del repo, no para hacerlo secreto. Si usas TURN, usa
> credenciales efímeras.

## Detalles que conviene saber

- **iOS / Safari**: la cámara sólo funciona en HTTPS y no funciona dentro de navegadores
  embebidos (Instagram, Facebook…). Abre el enlace en Safari o Chrome.
- **Pantalla del móvil**: Screen Wake Lock la mantiene encendida (Chrome Android,
  Safari 16.4+). Si no está soportada, deja la pestaña al frente.
- **Latencia** típica: 100-300 ms. El *saludo* tarda 2-4 s por el ICE no-trickle; la
  latencia del video no se ve afectada.
- **Bitrate de la cámara**: 4 Mbps en 1080p, 2.5 en 720p. Se ajusta en `BITRATE` dentro
  de `js/phone.js`.
- **Reconexión**: si la conexión se cae, el receptor vuelve a sondear solo. Basta pulsar
  **Transmitir** otra vez. En la PC, **Reiniciar sesión** limpia el buzón y espera de nuevo.
- **Limpieza**: al detener se borra sólo el flujo correspondiente, así reiniciar la
  pantalla no tumba la cámara. Lo abandonado caduca a los 10 minutos (`TTL_MS`).
- **Sala**: 4-12 caracteres `A-Z 0-9`, validado en cliente y en servidor. El código es el
  secreto compartido.
- **El servidor local sirve por lista blanca** (`*.html`, `js/*.js`, `css/*.css`): no
  expone `package.json`, `scripts/` ni `.env` aunque estén en la carpeta.

## Lo que esto NO puede hacer

Una web app no puede registrar una cámara ni una pantalla en Windows — está en un sandbox.
Por eso la cámara virtual la da OBS y el monitor extendido un driver IddCx. Alternativas
ya empaquetadas: **cámara** → Camo, Iriun, DroidCam. **Monitor** → spacedesk, Duet, Luna.
