# Toque

Convierte tu teléfono o tablet en **teclado y trackpad remotos** para tu PC con Windows, desde el navegador y por WiFi. Sin apps, sin cuentas: la PC ejecuta un pequeño servidor local y el teléfono abre una página.

## Uso

```
npm install
npm start
```

1. Al iniciar se abre `http://localhost:8765` en la PC con un código QR (también aparece en la terminal).
2. Escanea el QR con la cámara del teléfono o tablet (deben estar en la misma red WiFi).
3. Listo: la parte superior es el trackpad y abajo está el teclado.

> La primera vez, Windows preguntará si permites que Node.js use la red privada — acepta.

## Gestos del trackpad

| Gesto | Acción |
|---|---|
| Deslizar un dedo | Mover el cursor (con aceleración) |
| Toque con un dedo | Clic izquierdo |
| Toque con dos dedos | Clic derecho |
| Deslizar con dos dedos | Scroll natural (vertical y horizontal) |
| Doble toque y mantener | Arrastrar |

## Teclado

Distribución latinoamericana estilo Magic Keyboard:

- **Acentos**: toca `´` y luego la vocal (`´` + `a` → `á`); con shift produce diéresis (`ü`).
- **Atajos**: los modificadores `ctrl`, `alt`, `⌘` (tecla Windows) y `⇧` se quedan activos hasta la siguiente tecla — toca `ctrl` y luego `c` para copiar.
- **Bloq mayús**: doble toque en `⇧` o la tecla `⇪`.
- **Mantén pulsada** `q` para `@` y `e` para `€`.
- Fila superior: `esc`, controles multimedia, volumen y `supr`.
- El botón del teclado en la barra superior lo oculta para usar todo como trackpad.

## Cómo funciona

- `server.mjs` — servidor HTTP + WebSocket en el puerto `8765`. Sirve la interfaz y traduce los eventos del teléfono a comandos para el inyector.
- `input-helper.ps1` — proceso PowerShell/C# que inyecta la entrada real con `SendInput` (user32.dll). Sin dependencias nativas de npm.
- `public/` — interfaz web: `index.html` (QR en la PC) y `remote.html` (control en el teléfono).

### Seguridad

- La URL incluye un token (guardado en `.token`); las conexiones WebSocket sin token válido se rechazan.
- El QR y el token solo se muestran a peticiones desde la propia PC (`localhost`).
- Todo ocurre en tu red local; nada sale a internet.

### Limitaciones

- Solo Windows (la inyección usa la API de Windows).
- No puede escribir en ventanas elevadas (ejecutadas como administrador), salvo que el servidor también se ejecute como administrador.
