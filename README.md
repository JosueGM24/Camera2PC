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

Las URLs van **sin extensión** (`/pc`, no `/pc.html`): el QR sale más simple y la dirección
que pegas en OBS es más corta. Los archivos siguen siendo `.html` en disco; lo resuelven
`netlify.toml` y el servidor local.

| URL | Dónde se abre | Para qué |
|---|---|---|
| `/` | cualquiera | Elegir rol (detecta si estás en móvil o PC) |
| `/pc` | PC | **Recibe la cámara**: código, QR, stats, foto, grabación, y la guía de OBS |
| `/phone` | teléfono | **Envía la cámara**: escáner de QR, cámara, resolución, linterna |
| `/obs` | PC (dentro de OBS) | Receptor "limpio" para el Browser Source |
| `/screen` | PC | **Envía la pantalla** a la tablet (segundo monitor) |
| `/view` | tablet | **Recibe la pantalla**, sin recortar, sin apagarse |

Los dos flujos (`cam` y `screen`) comparten el mismo código de sala y conviven sin
estorbarse: puedes tener la cámara del teléfono en la PC y la pantalla de la PC en la
tablet a la vez.

---

## Conectar por cable USB

El truco no es el USB en sí, sino conseguir un **enlace IP por el cable**. El anclaje
por USB hace exactamente eso: PC y teléfono quedan en la misma subred y WebRTC elige esa
ruta él solo. Menos latencia, sin saturar el Wi-Fi, y el teléfono se carga.

### Por qué hace falta el anclaje, y no basta el cable

El USB no transporta video por sí solo: los dispositivos **declaran una clase**, y un
teléfono declara almacenamiento (MTP), depuración (ADB) o red (RNDIS al anclar). No
declara *USB Video Class*, que es lo que haría que Windows lo viera como webcam. Así que
no hay ningún flujo de video que leer al otro lado del cable.

El navegador tampoco puede saltárselo: **WebUSB bloquea a propósito las clases
protegidas** (video, audio, HID, almacenamiento), precisamente para que una pestaña no
pueda reclamar tu webcam.

El anclaje resuelve esto sin trucos: hace que el cable transporte **paquetes IP**. A
WebRTC le da igual el medio físico, sólo necesita alcanzabilidad por IP — por eso el video
acaba yendo por el cable sin que el código sepa que hay un cable.

**¿Y sin anclaje?** Se puede con ADB, que mueve TCP por el cable: así funcionan `scrcpy`
y el modo USB de DroidCam. Pero necesitan un proceso nativo en la PC que decodifique
H.264 y alimente una cámara virtual; un navegador no abre sockets TCP crudos. La variante
web (`adb reverse` + WebSocket + `MediaRecorder`) funcionaría, pero con bastante más
latencia que WebRTC porque `MediaRecorder` trabaja por bloques. No compensa cambiar un
interruptor de anclaje por medio segundo de retraso.

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

Una página web no puede registrar una pantalla en Windows — eso pide un driver IddCx,
igual que la cámara pide uno. Mismo patrón que OBS: un driver ya hecho aporta lo que el
navegador no puede, y nosotros ponemos el transporte.

1. Instala [Virtual Display Driver](https://github.com/itsmikethetech/Virtual-Display-Driver)
   (gratuito, código abierto), siguiendo las instrucciones de esa página: el
   procedimiento cambia entre versiones.
2. Windows → **Configuración → Pantalla**: aparece un monitor nuevo. Elige
   **Extender estas pantallas**.
3. Ponle **la resolución de tu tablet**. `view.html` te la dice: la escribe en la
   pantalla de espera, ya multiplicada por el `devicePixelRatio`.
4. Arrastra ahí las ventanas que quieras.
5. En `screen.html`, al compartir elige **ese** monitor.

`/screen` tiene la guía paso a paso en pantalla, visible hasta que la marcas como hecha.

**A favor:** no instalas nada en la tablet, sólo el navegador, y viaja por el mismo enlace
USB. **En contra:** sin táctil — tocar la tablet no controla Windows — y ~100-300 ms de
latencia, que va bien para documentación, chat, dashboards o monitoreo, pero no para
dibujar ni jugar.

### El modo espejo sigue estando

Sin driver, `screen.html` manda **una ventana suelta o una pestaña** a la tablet, que es
útil por sí mismo: dejar la documentación o el chat de la reunión en la tablet sin tocar
el escritorio. Opciones: prioridad **texto nítido** (`contentHint = 'text'` +
`maintain-resolution`) o **movimiento fluido**; bitrate hasta 12 Mbps; 15/30/60 fps; y
audio del sistema opcional.

En la tablet, `view.html` va a pantalla completa, no recorta la imagen, mantiene la
pantalla encendida con Wake Lock y esconde su barra a los 3 segundos.

---

## Identidad visual

La interfaz se comporta como el frontal de un equipo de rack, porque lo que hace la app
es **enrutar una señal entre dos extremos**.

**La firma es el camino de señal** (`js/ui.js` → `createLink`). No es un adorno: codifica
cosas verdaderas. El color dice de qué flujo se trata; las rayas viajan sólo cuando hay
video pasando; si la ruta va por un TURN el camino **se dobla** por un tercer nodo; si va
por cable, se rotula. En `index.html` el mismo componente es la navegación — los nodos
son los enlaces, y por eso no hay rejilla de tarjetas.

| Decisión | Por qué |
|---|---|
| Grafito cálido (`--ink-900` … `--ink-100`) | Chapa de equipo, no negro. Coherente con `obs.html` y `view.html`, que deben ser negros. |
| **Dos** colores de señal: `--cam` ámbar, `--screen` verde-azulado | La app tiene exactamente dos flujos. El color es estructura. `[data-flow]` en `<body>` los conmuta. |
| "Esperando" se dice con movimiento, no con color | Evita un tercer color compitiendo. El punto de estado respira. |
| `--alert` sólo para errores | Un color reservado para una sola cosa. |
| Display en DIN: Bahnschrift (Windows), DIN Alternate (iOS) | Letra de rotulación industrial, y **ya instalada**: el modo cable sin internet no puede depender de un CDN de fuentes. |
| Datos en Cascadia Mono / Consolas | La app muestra telemetría real (RTT, resoluciones, kbps). La monoespaciada es estructural. |
| `<details class="fold">` para todo lo secundario | La causa de que se viera abrumador era la densidad, no el color. Cada página tiene **una** acción primaria; el resto se despliega. Lo que abres se recuerda. |
| Iconos SVG en línea (`paintIcons`) | Sin peticiones externas y heredan `currentColor`. |

Piso de calidad: `:focus-visible` en todo lo enfocable, `aria-label` en cada botón de sólo
icono, `prefers-reduced-motion` respetado, y el patchbay se reordena en vertical por
debajo de 620 px.

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

1. En la PC abre `/pc`. Aparece un código de sala y un QR.
2. En el teléfono, abre `/phone` y pulsa el botón de **escanear** junto al código: la app
   lee el QR ella misma y arranca la transmisión. No hace falta una app de códigos.
3. El video aparece en 2-4 segundos (se espera a que ICE termine de reunir).

El escáner usa `BarcodeDetector`, que es nativo del navegador — sin librerías ni
descargas, así que también funciona en el modo cable sin internet. Safari no lo trae; ahí
se escribe el código a mano, que son seis caracteres sin letras ambiguas (no hay `I`,
`L`, `O`, `0` ni `1`).

### Como cámara en Zoom, Google Meet o Teams

La guía completa está dentro de `pc.html`, visible hasta que la marcas como hecha (se
recuerda en `localStorage`). Resumen:

1. Instala [OBS Studio](https://obsproject.com/download).
2. OBS → **Ajustes → Video**: resolución base y de salida en `1920x1080`. Si no, salen
   barras negras en la reunión.
3. **Fuentes → + → Navegador**: pega la URL que muestra `pc.html`, ancho `1920`, alto
   `1080`. Marca *Controlar audio mediante OBS* si quieres también el micrófono.
4. Click derecho en la fuente → **Cambiar a pantalla completa**.
5. **Iniciar cámara virtual**.
6. Elige **OBS Virtual Camera** en tu reunión: Meet → ajustes → vídeo; Zoom → vídeo →
   cámara; Teams → dispositivos.

Dos cosas que suelen morder:

- Si la reunión ya estaba abierta, **ciérrala y vuelve a entrar**: muchas apps sólo leen
  la lista de cámaras al arrancar.
- Deja abiertas la pestaña de `pc.html` y OBS durante toda la reunión.

La URL de OBS no cambia: el código de sala se guarda en `localStorage`, así que configuras
la fuente una vez y te olvidas.

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
ya empaquetadas, si algún día quieres comparar: **cámara** → Camo, Iriun, DroidCam.
