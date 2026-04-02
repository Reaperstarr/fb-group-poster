#!/usr/bin/env node
/**
 * Migra blobs con nombre antiguo manatal-{id}-cv.pdf → {carpeta}/cv-{id}.pdf
 * (copia + borra original; no hay rename nativo en Azure Blob).
 *
 * Uso:
 *   Desde la raíz del repo (fb-group-poster/):
 *     npm run mirror:migrate:dry
 *     npm run mirror:migrate
 *   Desde manatal-cv-mirror/:
 *     npm run migrate-blobs:dry
 *     node scripts/migrate-rename-blobs.js --dry-run
 *
 * Variables (o .env en la carpeta padre del script = manatal-cv-mirror):
 *   AZURE_STORAGE_CONNECTION_STRING  (obligatoria)
 *   AZURE_STORAGE_CONTAINER        (opcional, default manatal-cv)
 *   CV_UPLOAD_FOLDER               (carpeta destino, default CV)
 *   MIGRATE_SOURCE_PREFIX          (opcional, p.ej. ManatalCV — solo listar bajo ese prefijo)
 *
 * Opciones CLI:
 *   --dry-run              Solo muestra qué haría
 *   --force                Sobrescribe si ya existe el destino
 *   --env-file RUTA        Cargar variables desde ese archivo (además de manatal-cv-mirror/.env)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BlobServiceClient } = require('@azure/storage-blob');

const scriptDir = __dirname;
const rootDir = path.join(scriptDir, '..');

function parseEnvFileCliArg() {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--env-file=')) return a.slice('--env-file='.length).trim();
    if (a === '--env-file' && argv[i + 1]) return argv[i + 1].trim();
  }
  return null;
}

function loadDotEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.warn('No se pudo leer', filePath, e.message);
    return;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    // Si .env tiene primero KEY= vacío (plantilla) y después KEY=valor, hay que aceptar el valor.
    const hasVal = String(v).trim() !== '';
    const curEmpty =
      process.env[k] === undefined || String(process.env[k] ?? '').trim() === '';
    if (hasVal) process.env[k] = v;
    else if (curEmpty) process.env[k] = v;
  }
}

function loadAllEnvFiles() {
  const seen = new Set();
  const tryPath = (p) => {
    const abs = path.resolve(p);
    if (seen.has(abs)) return;
    seen.add(abs);
    loadDotEnvFile(abs);
  };

  const explicit = parseEnvFileCliArg();
  if (explicit) tryPath(explicit);

  tryPath(path.join(rootDir, '.env'));

  const repoRoot = path.join(rootDir, '..');
  if (path.resolve(repoRoot) !== path.resolve(rootDir)) {
    tryPath(path.join(repoRoot, '.env'));
  }

  const cwd = process.cwd();
  if (path.resolve(cwd) !== path.resolve(rootDir) && path.resolve(cwd) !== path.resolve(repoRoot)) {
    tryPath(path.join(cwd, '.env'));
  }
}

loadAllEnvFiles();

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

function normalizeStorageConnectionString(raw) {
  let s = String(raw || '').trim().replace(/^\uFEFF/, '');
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\s*[\r\n]+\s*/g, '').replace(/\s+;/g, ';');
}

function accountKeyDiagnostics(cs) {
  const str = String(cs || '');
  const m = str.match(/AccountKey=([^;]*)/i);
  if (!m) return 'No aparece AccountKey=…; en la cadena (¿pegaste la Connection string completa?).';
  const keyPart = m[1].trim();
  if (!keyPart) return 'AccountKey= está vacío (truncado al pegar o línea partida).';
  if (keyPart.length < 40)
    return `AccountKey demasiado corto (${keyPart.length} caracteres); suele ser ~88+. Volvé a copiar desde Access keys.`;
  if (!/^[A-Za-z0-9+/=]+$/.test(keyPart))
    return 'AccountKey tiene caracteres raros (espacios, comillas, HTML). Pegá solo la cadena del portal.';
  return `AccountKey longitud OK (${keyPart.length}). Si sigue fallando, regenerá key2 en Azure y copiá de nuevo.`;
}

function diagnoseEmptyConnectionStringEnv() {
  const repoRoot = path.join(rootDir, '..');
  const paths = [path.join(rootDir, '.env'), path.join(repoRoot, '.env')];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      if (k !== 'AZURE_STORAGE_CONNECTION_STRING') continue;
      const v = t.slice(i + 1).trim();
      if (v === '' || /^['"]\s*['"]?$/.test(v)) {
        return { file: p, reason: 'empty' };
      }
      return { file: p, reason: 'hasValue' };
    }
  }
  return null;
}

async function main() {
  const cs = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!cs || !String(cs).trim()) {
    const hint = diagnoseEmptyConnectionStringEnv();
    const repoRoot = path.join(rootDir, '..');
    const emptyHint =
      hint && hint.reason === 'empty'
        ? `\n⚠ Detectamos ${path.basename(hint.file)} con AZURE_STORAGE_CONNECTION_STRING= pero SIN valor después del =.\n  Pegá la Connection string COMPLETA en esa misma línea (Portal → Storage → Access keys).\n`
        : '';
    console.error(`Falta AZURE_STORAGE_CONNECTION_STRING.${emptyHint}

La variable suele estar solo en Azure hasta que la copies a tu PC.

Carpeta del mirror (cd aquí o usá npm run desde la raíz del repo):
  ${rootDir}

Donde poner .env (el script busca en este orden):
  • ${path.join(rootDir, '.env')}
  • ${path.join(repoRoot, '.env')}   (raíz del repo, ej. fb-group-poster/.env)

Contenido mínimo (una línea, sin saltos):
  AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net
  (Azure Portal → Storage account → Access keys → Connection string)

Desde la raíz del repo:
  cd ${repoRoot}
  npm run mirror:migrate:dry

O exportá en la terminal:
  export AZURE_STORAGE_CONNECTION_STRING='DefaultEndpointsProtocol=https;...'

O:
  node ${path.join(rootDir, 'scripts', 'migrate-rename-blobs.js')} --dry-run --env-file /ruta/.env
`);
    process.exit(1);
  }

  const containerName =
    (process.env.AZURE_STORAGE_CONTAINER || 'manatal-cv').replace(/^\/+|\/+$/g, '') ||
    'manatal-cv';
  const destFolder =
    (process.env.CV_UPLOAD_FOLDER || 'CV').replace(/^\/+|\/+$/g, '') || 'CV';
  const sourcePrefix = (process.env.MIGRATE_SOURCE_PREFIX || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+$/, '');

  const listOpts = sourcePrefix ? { prefix: sourcePrefix + '/' } : {};

  const csNorm = normalizeStorageConnectionString(cs);
  if (csNorm !== String(cs).trim()) {
    process.env.AZURE_STORAGE_CONNECTION_STRING = csNorm;
  }

  let client;
  try {
    client = BlobServiceClient.fromConnectionString(csNorm);
  } catch (e) {
    const msg = e.message || String(e);
    if (/AccountKey|Connection String|connection string/i.test(msg)) {
      console.error(`
Error al interpretar AZURE_STORAGE_CONNECTION_STRING:
  ${msg}

${accountKeyDiagnostics(csNorm)}

Comprobaciones:
  • Portal → tu Storage account (el del contenedor manatal-cv) → Access keys → Connection string.
  • Todo en UNA línea en .env: AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=...
  • Sin comillas sueltas a la mitad; si usás comillas, que envuelvan toda la cadena.
  • No uses la cadena de otro servicio (App Service, SQL, etc.).
`);
      process.exit(1);
    }
    throw e;
  }

  const container = client.getContainerClient(containerName);

  const re = /(^|.*\/)manatal-(\d+)-cv\.pdf$/i;

  let wouldCopy = 0;
  let copied = 0;
  let skipped = 0;
  const errors = [];

  for await (const blob of container.listBlobsFlat(listOpts)) {
    const name = blob.name;
    const m = name.match(re);
    if (!m) continue;

    const id = m[2];
    const newName = `${destFolder}/cv-${id}.pdf`;
    const downloadFilename = `cv-${id}.pdf`;

    if (name === newName) {
      skipped++;
      continue;
    }

    const destClient = container.getBlockBlobClient(newName);
    const exists = await destClient.exists();
    if (exists && !FORCE) {
      console.warn('Destino ya existe (usá --force para sobrescribir):', newName);
      skipped++;
      continue;
    }

    console.log(`${DRY ? '[dry-run] ' : ''}${name}  →  ${newName}`);
    wouldCopy++;

    if (DRY) continue;

    try {
      const srcClient = container.getBlockBlobClient(name);
      const buf = await srcClient.downloadToBuffer();
      await destClient.uploadData(buf, {
        blobHTTPHeaders: {
          blobContentType: 'application/pdf',
          blobContentDisposition: `inline; filename="${downloadFilename.replace(/"/g, '')}"`
        }
      });
      await srcClient.deleteIfExists({ deleteSnapshots: 'include' });
      copied++;
    } catch (e) {
      errors.push({ name, error: e.message || String(e) });
      console.error('Error:', name, e.message || e);
    }
  }

  console.log(
    DRY
      ? `\nDry-run: ${wouldCopy} blob(s) a migrar. Ejecutá sin --dry-run para aplicar.`
      : `\nHecho: ${copied} migrados, ${skipped} omitidos, ${errors.length} error(es).`
  );
  if (errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
