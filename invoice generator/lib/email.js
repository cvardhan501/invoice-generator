/**
 * Resend Email Integration for Administrator PIN Reset
 * 
 * Strict Enforcement:
 * - Only sends to authorized recipient: nakshashreyas@gmail.com
 * - Construct secure reset URL using validated APP_BASE_URL (HTTPS in production)
 * - Safe error handling: never exposes API keys or stack traces
 */

const ALLOWED_ADMIN_EMAIL = 'nakshashreyas@gmail.com';

function getAppBaseUrl() {
  const urlStr = process.env.APP_BASE_URL || 'http://localhost:3000';
  try {
    const url = new URL(urlStr.trim());
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      console.warn('[Warning] APP_BASE_URL should use HTTPS in production. Current:', url.origin);
    }
    return url.origin;
  } catch {
    return 'http://localhost:3000';
  }
}

async function sendResetEmail({ rawToken, requestedRecipient }) {
  // 1. Strict Recipient Enforcement
  if (requestedRecipient && requestedRecipient.trim().toLowerCase() !== ALLOWED_ADMIN_EMAIL) {
    const err = new Error('Reset emails can only be sent to the authorized administrator address.');
    err.code = 'RECIPIENT_REJECTED';
    throw err;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  if (!apiKey || !apiKey.trim()) {
    const err = new Error('RESEND_API_KEY is not configured on the server.');
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  const baseUrl = getAppBaseUrl();
  const resetUrl = `${baseUrl}/reset-pin.html?token=${rawToken}`;

  const payload = {
    from: fromEmail,
    to: [ALLOWED_ADMIN_EMAIL],
    subject: 'Invoice Generator: Secure Administrator PIN Reset Link',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:auto;color:#1a2332;padding:24px;border:1px solid #e2e8f0;border-radius:10px">
        <h2 style="color:#1e4b8c;margin-top:0">Reset Administrator PIN</h2>
        <p>A request was received to reset your global Invoice Generator administrator PIN.</p>
        <p style="margin:28px 0">
          <a href="${resetUrl}" style="display:inline-block;background:#1e4b8c;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Reset Administrator PIN</a>
        </p>
        <p style="color:#54617a;font-size:14px">This single-use link expires in <strong>15 minutes</strong>.</p>
        <p style="color:#54617a;font-size:14px">If you did not make this request, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="color:#687386;font-size:12px;line-height:1.5">
          This PIN reset updates the central MongoDB Atlas record and applies across all connected devices and browsers.
        </p>
      </div>
    `,
    text: `Reset your Invoice Generator administrator PIN using this single-use link (expires in 15 minutes):\n${resetUrl}\n\nIf you did not request this, ignore this email.`
  };

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10000);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: timeout.signal
    });

    let data = null;
    try { data = await res.json(); } catch {}

    if (!res.ok) {
      const msg = data && data.message ? data.message : `HTTP ${res.status}`;
      console.error(`[Resend Error] Status: ${res.status}, Name: ${data?.name || 'unknown'}: ${msg}`);
      const err = new Error(msg);
      err.statusCode = res.status;
      err.code = res.status === 401 ? 'INVALID_API_KEY' : (res.status === 403 ? 'SENDER_REJECTED' : 'PROVIDER_ERROR');
      throw err;
    }

    const messageId = data && data.id ? data.id : null;
    console.log(`[Resend Success] Email accepted for delivery to ${ALLOWED_ADMIN_EMAIL}. Message ID: ${messageId}`);
    return { ok: true, messageId };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Connection to email provider timed out.');
      timeoutErr.code = 'NETWORK_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  sendResetEmail,
  ALLOWED_ADMIN_EMAIL
};
