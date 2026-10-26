/**
 * POST /api/auth/login
 * Verifies 4-digit PIN against MongoDB Atlas authoritative record.
 * Issues HttpOnly signed session cookie upon success.
 */

const { connectToDatabase } = require('../../lib/mongodb');
const { verifyPin, signSession, createSessionCookie, isRequestSecure, attachCookie } = require('../../lib/auth');
const { validatePin, readJsonBody, sendJson, getClientIp } = require('../../lib/validation');
const { checkRateLimit, recordFailure, clearFailures } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed. Use POST.' });
  }

  const clientIp = getClientIp(req);

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: 'Invalid JSON request payload.' });
  }

  const { pin } = body;
  if (!validatePin(pin)) {
    return sendJson(res, 400, {
      ok: false,
      category: 'pin_invalid',
      error: 'Please enter a valid 4-digit numeric PIN.'
    });
  }

  let db;
  try {
    const conn = await connectToDatabase();
    db = conn.db;
  } catch (err) {
    console.error('[Login DB Error]', err.message);
    return sendJson(res, 503, {
      ok: false,
      category: 'database_unavailable',
      error: 'Authentication service is temporarily unavailable.'
    });
  }

  // Check brute force rate limit / lockout
  const lockout = await checkRateLimit(clientIp, db);
  if (lockout.locked) {
    return sendJson(res, 429, {
      ok: false,
      category: 'account_locked',
      error: `Too many failed login attempts. Temporarily locked for ${lockout.remainingSeconds} seconds. You can also reset your PIN by email.`,
      remainingSeconds: lockout.remainingSeconds
    });
  }

  try {
    const settings = await db.collection('admin_settings').findOne({ _id: 'admin_pin_config' });
    if (!settings || !settings.pin_hash) {
      return sendJson(res, 400, {
        ok: false,
        category: 'not_configured',
        error: 'Administrator PIN has not been initialized. Please complete initial setup.'
      });
    }

    const isValid = verifyPin(pin, settings.pin_hash);
    if (!isValid) {
      const fail = await recordFailure(clientIp, db);
      const errorMsg = fail.locked
        ? `Too many failed attempts. Login is locked for ${fail.remainingSeconds} seconds.`
        : `Incorrect PIN. Try again. (${fail.attemptsRemaining} attempt${fail.attemptsRemaining === 1 ? '' : 's'} remaining)`;

      return sendJson(res, 401, {
        ok: false,
        category: fail.locked ? 'account_locked' : 'invalid_pin',
        error: errorMsg,
        attemptsRemaining: fail.attemptsRemaining
      });
    }

    // Success: clear failed attempts
    await clearFailures(clientIp, db);

    // Issue signed session cookie
    const sessionVersion = settings.session_version || 1;
    const sessionToken = signSession(sessionVersion);
    const cookieStr = createSessionCookie(sessionToken, isRequestSecure(req));
    attachCookie(res, cookieStr);

    return sendJson(res, 200, {
      ok: true,
      category: 'login_success',
      message: 'Logged in successfully.'
    });
  } catch (err) {
    console.error('[Login Processing Error]', err.message);
    return sendJson(res, 500, {
      ok: false,
      error: 'An internal error occurred during login verification.'
    });
  }
};
