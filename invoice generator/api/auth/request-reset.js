/**
 * POST /api/auth/request-reset
 * Generates single-use, 15-minute reset token, stores hash in MongoDB,
 * and sends link exclusively to nakshashreyas@gmail.com via Resend.
 */

const crypto = require('crypto');
const { connectToDatabase } = require('../../lib/mongodb');
const { sendResetEmail, ALLOWED_ADMIN_EMAIL } = require('../../lib/email');
const { readJsonBody, sendJson, getClientIp } = require('../../lib/validation');

function sha256(val) {
  return crypto.createHash('sha256').update(val).digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed. Use POST.' });
  }

  const clientIp = getClientIp(req);

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {}

  // Reject attempt to divert reset email away from ALLOWED_ADMIN_EMAIL
  const requestedEmail = (body.email || body.to || body.recipient || '').trim().toLowerCase();
  if (requestedEmail && requestedEmail !== ALLOWED_ADMIN_EMAIL) {
    return sendJson(res, 400, {
      ok: false,
      category: 'recipient_rejected',
      error: 'Reset emails can only be sent to the authorized administrator address.'
    });
  }

  let db;
  try {
    const conn = await connectToDatabase();
    db = conn.db;
  } catch (err) {
    console.error('[Request Reset DB Error]', err.message);
    return sendJson(res, 503, {
      ok: false,
      category: 'database_unavailable',
      error: 'Reset service is temporarily unavailable.'
    });
  }

  // Generate 32-byte cryptographically secure unpredictable token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes

  try {
    // Store token hash in MongoDB Atlas with TTL index support
    await db.collection('admin_reset_tokens').insertOne({
      token_hash: tokenHash,
      expires_at: expiresAt,
      used: false,
      created_at: now,
      created_by_ip: clientIp
    });

    // Send email via Resend
    const emailResult = await sendResetEmail({
      rawToken,
      requestedRecipient: requestedEmail
    });

    return sendJson(res, 200, {
      ok: true,
      category: 'provider_accepted',
      message: 'Reset link email accepted for delivery to nakshashreyas@gmail.com.',
      resendId: emailResult.messageId
    });
  } catch (err) {
    // Revert token if Resend fails
    try {
      await db.collection('admin_reset_tokens').deleteOne({ token_hash: tokenHash });
    } catch {}

    console.error('[Request Reset Provider Error]', err.message);

    if (err.code === 'CONFIG_MISSING' || err.code === 'INVALID_API_KEY') {
      return sendJson(res, 502, {
        ok: false,
        category: 'invalid_resend_key',
        error: 'Email provider configuration error. Check RESEND_API_KEY.'
      });
    }

    if (err.code === 'SENDER_REJECTED') {
      return sendJson(res, 502, {
        ok: false,
        category: 'sender_rejected',
        error: 'The email provider rejected the sender address or recipient domain.'
      });
    }

    if (err.code === 'NETWORK_TIMEOUT') {
      return sendJson(res, 504, {
        ok: false,
        category: 'network_timeout',
        error: 'Connection to email provider timed out.'
      });
    }

    return sendJson(res, 502, {
      ok: false,
      category: 'provider_error',
      error: 'Unable to send reset email via Resend. Check server configuration.'
    });
  }
};
