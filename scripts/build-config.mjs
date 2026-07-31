#!/usr/bin/env node
// Genera js/env.generated.js con la configuracion ICE (STUN/TURN).
//
//   Local   : lee el archivo .env de la raiz (process.env tiene prioridad).
//   Netlify : lee las variables de Site configuration > Environment variables.
//
// Sin dependencias y sin variables obligatorias: si no defines nada, escribe
// los STUN publicos de Google. Solo necesitas tocar esto para usar un TURN.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'js', 'env.generated.js');

const DEFAULT_STUN = 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';

/** Parser minimo de .env: KEY=VALOR, ignora comentarios y quita comillas. */
function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  // replace(/^﻿/) : Notepad de Windows guarda con BOM y romperia la 1a clave.
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const dotenv = readDotEnv(join(root, '.env'));
const env = (key) => process.env[key] ?? dotenv[key] ?? '';
const list = (key, fallback = '') =>
  (env(key) || fallback).split(',').map((s) => s.trim()).filter(Boolean);

const iceServers = [{ urls: list('STUN_URLS', DEFAULT_STUN) }];

const turnUrls = list('TURN_URLS');
if (turnUrls.length) {
  const username = env('TURN_USERNAME');
  const credential = env('TURN_CREDENTIAL');
  if (!username || !credential) {
    console.error('\n  [build-config] TURN_URLS esta definido pero falta TURN_USERNAME o TURN_CREDENTIAL.\n');
    process.exit(1);
  }
  iceServers.push({ urls: turnUrls, username, credential });
}

const rtcConfig = { iceServers, iceCandidatePoolSize: 4 };

writeFileSync(
  OUT,
  `// ARCHIVO GENERADO por scripts/build-config.mjs - no lo edites ni lo commitees.
// Para cambiar estos valores edita .env (local) o las variables de entorno de Netlify.

export const rtcConfig = ${JSON.stringify(rtcConfig, null, 2)};
`,
  'utf8'
);

console.log(
  `  [build-config] js/env.generated.js escrito` +
  ` · STUN ${iceServers[0].urls.length}` +
  ` · TURN ${turnUrls.length ? 'si' : 'no'}`
);
