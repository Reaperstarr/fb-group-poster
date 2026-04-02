/**
 * Espejo de CV: POST multipart file + manatalId → OneDrive (Graph) → JSON { publicUrl }.
 * Pensado para Azure App Service; CORS para https://app.manatal.com
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol
} = require('@azure/storage-blob');

const MAX_BYTES = 15 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 }
});

const app = express();
app.use(
  cors({
    origin: 'https://app.manatal.com',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Api-Key'],
    maxAge: 86400
  })
);

/** Token en memoria (App Service una instancia; si escalás, usar Redis o sin caché). */
let tokenCache = { accessToken: null, expiresAt: 0 };

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing env ${name}`);
  }
  return String(v).trim();
}

function parseStorageConnectionString(cs) {
  const parts = {};
  String(cs)
    .split(';')
    .filter(Boolean)
    .forEach((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) return;
      parts[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    });
  const accountName = parts.accountname;
  const accountKey = parts.accountkey;
  if (!accountName || !accountKey) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING inválida (falta AccountName o AccountKey)');
  }
  return { accountName, accountKey };
}

function storageMode() {
  const cs = process.env.AZURE_STORAGE_CONNECTION_STRING;
  return cs && String(cs).trim() ? 'blob' : 'onedrive';
}

function sitePublicBase() {
  return String(process.env.SITE_PUBLIC_BASE || '')
    .trim()
    .replace(/\/+$/, '');
}

/** Secreto para firmar ?exp=&sig= en enlaces /c/:id (reclutadores no ven URL de Blob ni “manatal”). */
function cvLinkSigningSecret() {
  return String(process.env.CV_LINK_SECRET || process.env.MIRROR_API_KEY || '').trim();
}

function cvLinkExpiryUnixSec() {
  const days = Math.min(
    365 * 10,
    Math.max(1, parseInt(process.env.BLOB_SAS_EXPIRY_DAYS || '365', 10) || 365)
  );
  return Math.floor(Date.now() / 1000) + days * 86400;
}

function signCvAccess(manatalId, expUnix) {
  const secret = cvLinkSigningSecret();
  return crypto.createHmac('sha256', secret).update(`${manatalId}:${expUnix}`).digest('hex');
}

function verifyCvAccess(manatalId, expUnix, sigHex) {
  const secret = cvLinkSigningSecret();
  if (!secret || !/^\d+$/.test(String(manatalId))) return false;
  if (Number(expUnix) < Math.floor(Date.now() / 1000)) return false;
  if (!sigHex || typeof sigHex !== 'string' || !/^[a-f0-9]{64}$/i.test(sigHex)) return false;
  const expected = signCvAccess(manatalId, expUnix);
  try {
    return crypto.timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function blobContainerName() {
  return (process.env.AZURE_STORAGE_CONTAINER || 'manatal-cv').replace(/^\/+|\/+$/g, '') || 'manatal-cv';
}

function cvUploadFolder() {
  return (process.env.CV_UPLOAD_FOLDER || 'CV').replace(/^\/+|\/+$/g, '') || 'CV';
}

function getBlobContainerClient() {
  const cs = requireEnv('AZURE_STORAGE_CONNECTION_STRING');
  const blobServiceClient = BlobServiceClient.fromConnectionString(cs);
  return blobServiceClient.getContainerClient(blobContainerName());
}

/**
 * Localiza el PDF en el contenedor por manatalId (nombre actual o legado).
 */
async function findBlobPathForManatalId(containerClient, manatalId) {
  const id = String(manatalId || '').trim();
  if (!/^\d+$/.test(id)) return null;

  const folder = cvUploadFolder();
  const prefixes = [`${folder}/`, 'CV/', 'ManatalCV/'];
  const exactNames = [`cv-${id}.pdf`, `manatal-${id}-cv.pdf`];

  for (const pref of prefixes) {
    for (const name of exactNames) {
      const path = pref + name;
      if (await containerClient.getBlockBlobClient(path).exists()) return path;
    }
  }

  for (const pref of prefixes) {
    for await (const b of containerClient.listBlobsFlat({ prefix: pref })) {
      if (b.name.endsWith(`-${id}.pdf`)) return b.name;
    }
  }

  return null;
}

function buildProxyPublicCvUrl(manatalId, expUnix) {
  const base = sitePublicBase();
  const sig = signCvAccess(manatalId, expUnix);
  return `${base}/c/${encodeURIComponent(manatalId)}?exp=${expUnix}&sig=${encodeURIComponent(sig)}`;
}

function useProxyPublicCvUrls() {
  return (
    storageMode() === 'blob' &&
    Boolean(sitePublicBase()) &&
    Boolean(cvLinkSigningSecret())
  );
}

async function uploadToAzureBlob(buf, itemPath) {
  const cs = requireEnv('AZURE_STORAGE_CONNECTION_STRING');
  const containerName =
    (process.env.AZURE_STORAGE_CONTAINER || 'manatal-cv').replace(/^\/+|\/+$/g, '') || 'manatal-cv';
  const expiryDays = Math.min(
    365 * 10,
    Math.max(1, parseInt(process.env.BLOB_SAS_EXPIRY_DAYS || '365', 10) || 365)
  );

  const { accountName, accountKey } = parseStorageConnectionString(cs);
  const blobServiceClient = BlobServiceClient.fromConnectionString(cs);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  await containerClient.createIfNotExists();

  const blockBlobClient = containerClient.getBlockBlobClient(itemPath);
  const downloadName = String(itemPath.split('/').pop() || 'cv.pdf').replace(/"/g, '');
  await blockBlobClient.uploadData(buf, {
    blobHTTPHeaders: {
      blobContentType: 'application/pdf',
      blobContentDisposition: `inline; filename="${downloadName}"`
    }
  });

  const cred = new StorageSharedKeyCredential(accountName, accountKey);
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: itemPath,
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https
    },
    cred
  ).toString();

  const publicUrl = `${blockBlobClient.url}?${sas}`;
  return { publicUrl, itemPath, containerName };
}

async function getGraphAccessToken() {
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }
  const tenant = requireEnv('AZURE_TENANT_ID');
  const clientId = requireEnv('AZURE_CLIENT_ID');
  const clientSecret = requireEnv('AZURE_CLIENT_SECRET');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }
  );
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Token request failed ${res.status}: ${text.slice(0, 500)}`);
    err.status = 502;
    throw err;
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error('Token response not JSON');
    err.status = 502;
    throw err;
  }
  if (!json.access_token) {
    const err = new Error('No access_token in token response');
    err.status = 502;
    throw err;
  }
  const expiresIn = Number(json.expires_in) || 3600;
  tokenCache = {
    accessToken: json.access_token,
    expiresAt: now + expiresIn * 1000
  };
  return tokenCache.accessToken;
}

function checkApiKey(req, res, next) {
  const expected = process.env.MIRROR_API_KEY;
  if (!expected || !String(expected).trim()) {
    return next();
  }
  const got = req.get('x-api-key') || req.get('X-Api-Key') || '';
  if (got !== String(expected).trim()) {
    return res.status(401).json({ error: 'Invalid or missing X-Api-Key' });
  }
  next();
}

/** Nombre de archivo en blob/drive: {slug|cv}-{manatalId}.pdf (sin "manatal" en el nombre). */
function mirrorSafePdfFilename(manatalId, fileBaseRaw) {
  const safeId = String(manatalId || '').trim();
  let p = String(fileBaseRaw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  if (!p) p = 'cv';
  return `${p}-${safeId}.pdf`;
}

app.get('/', (_req, res) => {
  res.type('text/plain').send('Manatal CV mirror OK. POST /upload with multipart: file (PDF), manatalId.');
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'manatal-cv-mirror',
    storage: storageMode(),
    publicCvProxy: useProxyPublicCvUrls()
  });
});

/** PDF para reclutadores: URL sin cuenta Azure ni “manatal” en el dominio/ruta del blob. */
app.options('/c/:manatalId', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

app.get('/c/:manatalId', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const manatalId = String(req.params.manatalId || '').trim();
  const exp = req.query.exp;
  const sig = req.query.sig;

  if (!verifyCvAccess(manatalId, exp, sig)) {
    return res.status(403).type('text/plain').send('Enlace inválido o expirado.');
  }

  if (storageMode() !== 'blob') {
    return res.status(501).type('text/plain').send('Solo disponible con Azure Blob.');
  }

  try {
    const containerClient = getBlobContainerClient();
    const blobPath = await findBlobPathForManatalId(containerClient, manatalId);
    if (!blobPath) {
      return res.status(404).type('text/plain').send('CV no encontrado.');
    }

    const blobClient = containerClient.getBlockBlobClient(blobPath);
    const download = await blobClient.download();
    const filename = String(blobPath.split('/').pop() || 'cv.pdf').replace(/"/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const stream = download.readableStreamBody;
    if (!stream) {
      return res.status(500).type('text/plain').send('Sin cuerpo de respuesta.');
    }
    stream.on('error', (err) => {
      console.error('[cv-proxy] stream', err);
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (e) {
    console.error('[cv-proxy]', e);
    if (!res.headersSent) {
      res.status(500).type('text/plain').send('Error al leer el CV.');
    }
  }
});

app.post('/upload', checkApiKey, upload.single('file'), async (req, res) => {
  try {
    const manatalId = req.body && req.body.manatalId != null ? String(req.body.manatalId).trim() : '';
    if (!manatalId || !/^\d+$/.test(manatalId)) {
      return res.status(400).json({ error: 'manatalId requerido (solo dígitos)' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'file requerido (PDF)' });
    }
    const buf = req.file.buffer;
    if (buf.length < 64) {
      return res.status(400).json({ error: 'archivo demasiado pequeño' });
    }
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: 'PDF demasiado grande' });
    }
    // Evita guardar HTML/JSON de error como "PDF" (Chrome muestra "Failed to load PDF document").
    const pdfHead = buf.subarray(0, Math.min(1024, buf.length)).toString('latin1');
    if (!pdfHead.includes('%PDF')) {
      return res.status(400).json({
        error: 'El cuerpo no es un PDF válido (falta cabecera %PDF). Suele pasar si Manatal devolvió HTML o un error en lugar del archivo.'
      });
    }

    const folder = (process.env.CV_UPLOAD_FOLDER || 'CV').replace(/^\/+|\/+$/g, '') || 'CV';
    const fileBaseHint =
      req.body && req.body.fileBase != null ? String(req.body.fileBase).trim() : '';
    const safeFile = mirrorSafePdfFilename(manatalId, fileBaseHint);
    const itemPath = `${folder}/${safeFile}`;

    if (storageMode() === 'blob') {
      const { publicUrl: sasOrBlobUrl } = await uploadToAzureBlob(buf, itemPath);
      const expUnix = cvLinkExpiryUnixSec();
      const publicUrl = useProxyPublicCvUrls()
        ? buildProxyPublicCvUrl(manatalId, expUnix)
        : sasOrBlobUrl;
      return res.status(200).json({
        publicUrl,
        url: publicUrl,
        webViewLink: publicUrl,
        manatalId,
        path: itemPath,
        storage: 'blob',
        cvLinkExpiresAt: useProxyPublicCvUrls() ? expUnix : undefined
      });
    }

    const userId = requireEnv('GRAPH_TARGET_USER_ID');
    const pathForUrl = itemPath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');

    const token = await getGraphAccessToken();
    const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}`;
    const putUrl = `${base}/drive/root:/${pathForUrl}:/content`;

    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/pdf'
      },
      body: buf
    });
    if (!putRes.ok) {
      const t = await putRes.text();
      console.error('[upload] Graph PUT failed', putRes.status, t.slice(0, 800));
      return res.status(502).json({
        error: 'OneDrive upload failed',
        detail: t.slice(0, 300),
        status: putRes.status
      });
    }

    const createLinkUrl = `${base}/drive/root:/${pathForUrl}:/createLink`;
    const linkRes = await fetch(createLinkUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'view',
        scope: 'organization'
      })
    });
    const linkText = await linkRes.text();
    let publicUrl = '';
    if (linkRes.ok) {
      try {
        const linkJson = JSON.parse(linkText);
        publicUrl =
          linkJson.link?.webUrl ||
          linkJson.webUrl ||
          '';
      } catch (_) { /* ignore */ }
    } else {
      console.warn('[upload] createLink failed', linkRes.status, linkText.slice(0, 400));
    }

    if (!publicUrl) {
      const webUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        userId
      )}/drive/root:/${pathForUrl}`;
      return res.status(200).json({
        publicUrl: '',
        webViewLink: '',
        warning:
          'Archivo subido pero no se pudo crear enlace de organización. Revisá políticas del tenant o permisos. Path en OneDrive: ' +
          itemPath,
        graphItemHint: webUrl
      });
    }

    return res.status(200).json({
      publicUrl,
      url: publicUrl,
      webViewLink: publicUrl,
      manatalId,
      path: itemPath,
      storage: 'onedrive'
    });
  } catch (e) {
    const status = e.status || 500;
    console.error('[upload]', e);
    return res.status(status).json({
      error: e.message || 'server error'
    });
  }
});

const port = parseInt(process.env.PORT || '8787', 10);
app.listen(port, () => {
  console.log(`manatal-cv-mirror listening on ${port}`);
});
