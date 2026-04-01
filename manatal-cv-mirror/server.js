/**
 * Espejo de CV: POST multipart file + manatalId → OneDrive (Graph) → JSON { publicUrl }.
 * Pensado para Azure App Service; CORS para https://app.manatal.com
 */
'use strict';

const express = require('express');
const multer = require('multer');
const cors = require('cors');

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

app.get('/', (_req, res) => {
  res.type('text/plain').send('Manatal CV mirror OK. POST /upload with multipart: file (PDF), manatalId.');
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'manatal-cv-mirror' });
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

    const userId = requireEnv('GRAPH_TARGET_USER_ID');
    const folder = (process.env.CV_UPLOAD_FOLDER || 'ManatalCV').replace(/^\/+|\/+$/g, '') || 'ManatalCV';
    const safeFile = `manatal-${manatalId}-cv.pdf`;
    const itemPath = `${folder}/${safeFile}`;
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
      path: itemPath
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
