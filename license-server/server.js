const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const Stripe = require('stripe');

const PORT = Number(process.env.PORT || 8787);
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const APP_NAME = process.env.APP_NAME || 'Irishka Group Master by SBS';
const ALLOW_DEMO_ENDPOINT = String(process.env.ALLOW_DEMO_ENDPOINT || 'false').toLowerCase() === 'true';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || '';
const MAX_DEVICES_PER_LICENSE = Math.max(1, Number(process.env.MAX_DEVICES_PER_LICENSE || 1));

const STORE_FILE = path.join(__dirname, 'licenses.json');
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const licenses = new Map(); // key -> { email, plan, active, createdAt, updatedAt }

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

function isAdminRequest(req) {
  if (!ADMIN_API_TOKEN) return false;
  const bearer = getBearerToken(req);
  if (bearer && bearer === ADMIN_API_TOKEN) return true;
  const xToken = String(req.headers['x-admin-token'] || '').trim();
  return xToken === ADMIN_API_TOKEN;
}

function makeLicenseKey() {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

function safeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function safeDeviceId(deviceId) {
  const d = String(deviceId || '').trim().toLowerCase();
  if (!d) return '';
  if (d.length < 16 || d.length > 128) return '';
  if (!/^[a-z0-9_-]+$/.test(d)) return '';
  return d;
}

function saveStore() {
  const rows = [];
  for (const [key, value] of licenses.entries()) rows.push({ key, value });
  fs.writeFileSync(STORE_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) return;
  try {
    const txt = fs.readFileSync(STORE_FILE, 'utf8') || '[]';
    const rows = JSON.parse(txt);
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      if (!row || !row.key || !row.value) return;
      licenses.set(String(row.key), row.value);
    });
  } catch (e) {
    console.error('Could not load licenses.json:', e.message);
  }
}

function collectRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function collectJson(req) {
  return collectRawBody(req).then((buf) => {
    const txt = buf.toString('utf8') || '{}';
    return JSON.parse(txt);
  });
}

function createOrActivateLicense(email, plan) {
  const normalizedEmail = safeEmail(email);
  if (!normalizedEmail) return null;

  for (const [key, data] of licenses.entries()) {
    if (safeEmail(data.email) === normalizedEmail) {
      const next = { ...data, email: normalizedEmail, active: true, plan: plan || data.plan || 'PRO', updatedAt: new Date().toISOString() };
      licenses.set(key, next);
      saveStore();
      return key;
    }
  }

  const key = makeLicenseKey();
  licenses.set(key, {
    email: normalizedEmail,
    plan: plan || 'PRO',
    active: true,
    maxDevices: MAX_DEVICES_PER_LICENSE,
    devices: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  saveStore();
  return key;
}

function deactivateLicenseByEmail(email, reason) {
  const normalizedEmail = safeEmail(email);
  if (!normalizedEmail) return null;
  for (const [key, data] of licenses.entries()) {
    if (safeEmail(data.email) !== normalizedEmail) continue;
    const next = {
      ...data,
      active: false,
      reason: reason || 'Subscription inactive',
      updatedAt: new Date().toISOString()
    };
    licenses.set(key, next);
    saveStore();
    return key;
  }
  return null;
}

function sendLicenseEmail(email, key, plan) {
  if (!RESEND_API_KEY || !EMAIL_FROM || !email || !key) return Promise.resolve(false);
  const payload = JSON.stringify({
    from: EMAIL_FROM,
    to: [email],
    subject: APP_NAME + ' - Your license key',
    html:
      '<h2>' + APP_NAME + '</h2>' +
      '<p>Your plan is now active: <strong>' + String(plan || 'PRO') + '</strong>.</p>' +
      '<p>Your license key:</p>' +
      '<pre style="font-size:16px;padding:8px;background:#f5f5f5">' + key + '</pre>' +
      '<p>Open the extension, go to Activate license, paste the key and click Validate.</p>'
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      resolve(ok);
    });
    req.on('error', () => resolve(false));
    req.write(payload);
    req.end();
  });
}

function getEmailFromStripeEvent(event) {
  if (!event || !event.data || !event.data.object) return '';
  const obj = event.data.object;

  if (obj.customer_details && obj.customer_details.email) return obj.customer_details.email;
  if (obj.customer_email) return obj.customer_email;
  if (obj.receipt_email) return obj.receipt_email;

  if (obj.customer && typeof obj.customer === 'object' && obj.customer.email) return obj.customer.email;
  if (obj.billing_details && obj.billing_details.email) return obj.billing_details.email;
  return '';
}

async function handleValidate(req, res) {
  try {
    const body = await collectJson(req);
    const key = String(body.licenseKey || '').trim().toUpperCase();
    const deviceId = safeDeviceId(body.deviceId || '');
    if (!key) return json(res, 400, { valid: false, message: 'Missing license key' });
    if (!deviceId) return json(res, 400, { valid: false, message: 'Missing or invalid deviceId' });
    const lic = licenses.get(key);
    if (!lic) return json(res, 200, { valid: false, message: 'License not found' });
    if (!lic.active) return json(res, 200, { valid: false, message: 'License inactive' });

    const maxDevices = Math.max(1, Number(lic.maxDevices || MAX_DEVICES_PER_LICENSE));
    const devices = Array.isArray(lic.devices) ? lic.devices.slice() : [];
    if (!devices.includes(deviceId)) {
      if (devices.length >= maxDevices) {
        return json(res, 200, {
          valid: false,
          message: 'License already in use on another device',
          code: 'DEVICE_LIMIT_REACHED',
          allowedDevices: maxDevices
        });
      }
      devices.push(deviceId);
    }

    const next = {
      ...lic,
      maxDevices,
      devices,
      lastSeenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    licenses.set(key, next);
    saveStore();

    return json(res, 200, {
      valid: true,
      plan: next.plan || 'PRO',
      email: next.email,
      allowedDevices: maxDevices,
      usedDevices: devices.length
    });
  } catch (e) {
    return json(res, 500, { valid: false, message: e.message || 'Validation error' });
  }
}

/** Move license to this device only (replaces previous device bindings). Requires valid license key. */
async function handleTransferDevice(req, res) {
  try {
    const body = await collectJson(req);
    const key = String(body.licenseKey || '').trim().toUpperCase();
    const deviceId = safeDeviceId(body.deviceId || '');
    if (!key) return json(res, 400, { ok: false, message: 'Missing license key' });
    if (!deviceId) return json(res, 400, { ok: false, message: 'Missing or invalid deviceId' });
    const lic = licenses.get(key);
    if (!lic) return json(res, 200, { ok: false, message: 'License not found' });
    if (!lic.active) return json(res, 200, { ok: false, message: 'License inactive' });
    const maxDevices = Math.max(1, Number(lic.maxDevices || MAX_DEVICES_PER_LICENSE));
    const next = {
      ...lic,
      maxDevices,
      devices: [deviceId],
      transferredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    licenses.set(key, next);
    saveStore();
    return json(res, 200, {
      ok: true,
      valid: true,
      plan: next.plan || 'PRO',
      email: next.email,
      allowedDevices: maxDevices,
      usedDevices: 1
    });
  } catch (e) {
    return json(res, 500, { ok: false, message: e.message || 'Transfer error' });
  }
}

async function handleStripeWebhook(req, res) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return json(res, 500, { ok: false, message: 'Stripe not configured' });
  }
  try {
    const sig = req.headers['stripe-signature'];
    const raw = await collectRawBody(req);
    const event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const email = getEmailFromStripeEvent(event);
      const plan = 'PRO';
      const key = createOrActivateLicense(email, plan);
      const sent = await sendLicenseEmail(email, key, plan);
      console.log('License activated', { email, key, plan, emailSent: sent });
    }

    if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
      const email = getEmailFromStripeEvent(event);
      const key = deactivateLicenseByEmail(email, event.type);
      console.log('License deactivated', { email, key, reason: event.type });
    }

    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 400, { ok: false, message: e.message || 'Webhook error' });
  }
}

async function handleCreateDemoLicense(req, res) {
  if (!ALLOW_DEMO_ENDPOINT) {
    return json(res, 403, { ok: false, message: 'Demo endpoint disabled' });
  }
  if (!isAdminRequest(req)) {
    return json(res, 401, { ok: false, message: 'Unauthorized' });
  }
  try {
    const body = await collectJson(req);
    const email = String(body.email || '').trim();
    if (!email) return json(res, 400, { ok: false, message: 'Missing email' });
    const key = createOrActivateLicense(email, body.plan || 'PRO');
    return json(res, 200, { ok: true, licenseKey: key });
  } catch (e) {
    return json(res, 500, { ok: false, message: e.message || 'Error' });
  }
}

async function handleAdminResetDevice(req, res) {
  if (!isAdminRequest(req)) {
    return json(res, 401, { ok: false, message: 'Unauthorized' });
  }
  try {
    const body = await collectJson(req);
    const key = String(body.licenseKey || '').trim().toUpperCase();
    if (!key) return json(res, 400, { ok: false, message: 'Missing license key' });
    const lic = licenses.get(key);
    if (!lic) return json(res, 404, { ok: false, message: 'License not found' });
    const next = {
      ...lic,
      devices: [],
      updatedAt: new Date().toISOString()
    };
    licenses.set(key, next);
    saveStore();
    return json(res, 200, { ok: true, message: 'Device binding reset' });
  } catch (e) {
    return json(res, 500, { ok: false, message: e.message || 'Error' });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
  if (req.method === 'POST' && req.url === '/api/license/validate') return handleValidate(req, res);
  if (req.method === 'POST' && req.url === '/api/license/transfer-device') return handleTransferDevice(req, res);
  if (req.method === 'POST' && req.url === '/api/stripe/webhook') return handleStripeWebhook(req, res);
  if (req.method === 'POST' && req.url === '/api/license/create-demo') return handleCreateDemoLicense(req, res);
  if (req.method === 'POST' && req.url === '/api/license/reset-device') return handleAdminResetDevice(req, res);
  return json(res, 404, { ok: false, message: 'Not found' });
});

loadStore();
server.listen(PORT, () => {
  console.log(`License server listening on http://localhost:${PORT}`);
  console.log('Demo endpoint enabled:', ALLOW_DEMO_ENDPOINT ? 'yes' : 'no');
  console.log('Max devices per license:', MAX_DEVICES_PER_LICENSE);
});
