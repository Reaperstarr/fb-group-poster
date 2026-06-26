/**
 * Irishka Fleet Vision Guard — classify Facebook screenshots via OpenAI vision.
 * Critical → stay paused + alert. Everything else → auto-resume (Fleet "play").
 */
const https = require('https');

const CRITICAL_CATEGORIES = new Set([
  'automation_warning',
  'account_posting_blocked',
  'security_checkpoint',
  'session_logged_out',
  'account_disabled',
  'dialog_accept_required',
  'leave_site_prompt',
]);

const RESUME_CATEGORIES = new Set([
  'group_deleted',
  'group_not_member',
  'group_posting_disabled',
  'group_banned',
  'post_rejected_policy',
  'group_rate_limit',
  'duplicate_content',
  'pending_moderation',
  'dialog_dismissible',
  'composer_not_ready',
  'post_success',
  'normal_feed',
  'unknown_no_error',
  'screenshot_bad',
]);

const VISION_SYSTEM_PROMPT = `You analyze screenshots of Facebook while Irishka (a group posting tool) is paused after a failed or blocked post.

Return ONLY valid JSON with this exact shape:
{"category":"<id>","severity":"critical|group_fatal|temporary|minor|none","action":"stop|resume","confidence":0.0,"summary":"<one line>","visible_text":"<short excerpt or empty>"}

Category IDs (pick exactly one):
CRITICAL (action stop):
- automation_warning — Meta detected automated behavior
- account_posting_blocked — account cannot post globally
- security_checkpoint — identity verification, captcha, unusual activity
- session_logged_out — login page, session expired
- account_disabled — account suspended/disabled
- dialog_accept_required — blocking modal needing human accept/reject (not dismissible cookies)
- leave_site_prompt — browser "Leave site?" dialog

RESUME (action resume — skip this group or continue queue):
- group_deleted — group removed/unavailable
- group_not_member — must join group, not a member
- group_posting_disabled — only admins can post, posting turned off
- group_banned — removed/blocked from this group
- post_rejected_policy — post rejected by group rules (already failed)
- group_rate_limit — temporary limit for this group only
- duplicate_content — similar post blocked
- pending_moderation — post submitted, awaiting admin approval (success)
- dialog_dismissible — minor popup, cookies, "not now"
- composer_not_ready — page still loading
- post_success — post published or no error visible
- normal_feed — normal Facebook UI, no blocking issue
- unknown_no_error — unclear but no blocking error
- screenshot_bad — wrong tab, black screen, not Facebook

Rules:
- Default action is "resume" unless clearly CRITICAL.
- pending_moderation and post_success → resume.
- Group-only issues → resume (Irishka already advanced to next group).
- Be conservative on "stop": only when account-level risk or hard human-required modal.
- confidence 0.0–1.0 reflecting certainty.`;

function visionEnabled() {
  return String(process.env.IRISHKA_VISION_ENABLED || 'true').trim() !== 'false'
    && !!String(process.env.OPENAI_API_KEY || '').trim();
}

function visionModel() {
  return String(process.env.IRISHKA_VISION_MODEL || 'gpt-4o-mini').trim();
}

function minConfidence() {
  const n = Number(process.env.IRISHKA_VISION_MIN_CONFIDENCE || 0.85);
  return Number.isFinite(n) ? Math.max(0.5, Math.min(0.99, n)) : 0.85;
}

function openaiChatCompletion(body) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return Promise.resolve(null);
  const payload = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(45000, () => {
      req.destroy();
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

function normalizeAnalysis(raw) {
  const category = String(raw?.category || 'unknown_no_error').trim();
  let action = String(raw?.action || '').trim().toLowerCase();
  const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0));
  const summary = String(raw?.summary || '').slice(0, 240);
  const visibleText = String(raw?.visible_text || '').slice(0, 300);

  if (CRITICAL_CATEGORIES.has(category)) {
    action = 'stop';
  } else if (RESUME_CATEGORIES.has(category) || !action) {
    action = 'resume';
  } else if (action !== 'stop' && action !== 'resume') {
    action = 'resume';
  }

  let severity = String(raw?.severity || '').trim();
  if (!severity) {
    severity = CRITICAL_CATEGORIES.has(category) ? 'critical' : 'minor';
  }

  return { category, severity, action, confidence, summary, visibleText };
}

function buildUserPrompt(context) {
  const lines = ['Classify this Facebook screenshot for Irishka Fleet Vision Guard.'];
  if (context?.stopReason) lines.push(`Pause reason from extension: ${context.stopReason}`);
  if (context?.currentGroup) lines.push(`Current group: ${context.currentGroup}`);
  if (context?.lastError) lines.push(`Last error: ${context.lastError}`);
  if (context?.domHint) lines.push(`DOM hint: ${context.domHint}`);
  return lines.join('\n');
}

async function analyzeScreenshot(imageBase64, context) {
  if (!visionEnabled()) {
    return {
      ok: false,
      error: 'vision_disabled',
      analysis: normalizeAnalysis({ category: 'unknown_no_error', action: 'resume', confidence: 0 }),
    };
  }

  const b64 = String(imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!b64) {
    return { ok: false, error: 'no_image', analysis: null };
  }

  const imageUrl = `data:image/jpeg;base64,${b64.slice(0, 1_200_000)}`;
  const response = await openaiChatCompletion({
    model: visionModel(),
    response_format: { type: 'json_object' },
    max_tokens: 280,
    temperature: 0.1,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildUserPrompt(context || {}) },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
        ],
      },
    ],
  });

  const content = response?.choices?.[0]?.message?.content;
  if (!content) {
    const err = response?.error?.message || 'openai_empty_response';
    return {
      ok: false,
      error: err,
      analysis: normalizeAnalysis({ category: 'unknown_no_error', action: 'resume', confidence: 0 }),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      error: 'invalid_json',
      analysis: normalizeAnalysis({ category: 'unknown_no_error', action: 'resume', confidence: 0 }),
    };
  }

  return { ok: true, analysis: normalizeAnalysis(parsed) };
}

function shouldAutoAct(analysis) {
  if (!analysis) return false;
  return analysis.confidence >= minConfidence();
}

module.exports = {
  analyzeScreenshot,
  shouldAutoAct,
  visionEnabled,
  minConfidence,
  CRITICAL_CATEGORIES,
  RESUME_CATEGORIES,
};
