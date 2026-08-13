// Netlify tiene guardado en su panel el comando `node scripts/build-config.mjs`
// y publica la raíz del repositorio. Ese comando venía del proyecto anterior
// (generaba js/env.generated.js) y hacía fallar cada build al eliminarlo.
//
// Toque no se despliega: necesita ejecutarse en tu PC para inyectar mouse y
// teclado. Lo único que se publica es index.html, la página informativa.
// Este script solo comprueba que exista y termina bien.
//
// Para quitar el despliegue por completo, elimina el sitio en Netlify
// (Site configuration → General → Delete site); entonces borra este archivo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = path.join(root, 'index.html');

if (!fs.existsSync(page)) {
  console.error('Falta index.html en la raíz: no hay página que publicar.');
  process.exit(1);
}

console.log('Toque se ejecuta localmente; no hay nada que compilar.');
console.log(`Publicando la página informativa (${fs.statSync(page).size} bytes).`);
