/**
 * POST /api/auth/complete-reset
 * Validates reset token against MongoDB Atlas hash, verifies 15-minute expiry,
 * atomically consumes token, and updates central PIN hash.
 * Invalidates all previous active sessions.
 */

const crypto = require('crypto');
const { connectToDatabase } = require('../../lib/mongodb');
const { hashPin } = require('../../lib/auth');
const { validatePin, validateResetToken, readJsonBody, sendJson, getClientIp } = require('../../lib/validation');
const { clearAllLockouts } = require('../../lib/rate-limit');

function sha256(val) {
  return crypto.createHash('sha256').update(val).digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed. Use POST.' });
  }

  const clientIp = getClientIp(req);

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'Invalid JSON request payload.' });
  }

  const { token, pin } = body;
  if (!validateResetToken(token)) {
    return sendJson(res, 400, {
      ok: false,
      category: 'token_malformed',
      error: 'The reset link is malformed or invalid. Request a new link.'
    });
  }

  if (!validatePin(pin)) {
    return sendJson(res, 400, {
      ok: false,
      category: 'pin_invalid',
      error: 'Enter a valid 4-digit numeric PIN.'
    });
  }

  let db;
  try {
    const conn = await connectToDatabase();
    db = conn.db;
  } catch (err) {
    console.error('[Complete Reset DB Error]', err.message);
    return sendJson(res, 503, {
      ok: false,
      category: 'database_unavailable',
      error: 'Authentication database is unreachable.'
    });
  }

  const tokenHash = sha256(token.trim());
  const now = new Date();

  try {
    // Atomically find, validate expiry, and mark token as used in a single operation
    // Prevents concurrent race conditions and replay attacks
    const result = await db.collection('admin_reset_tokens').findOneAndUpdate(
      {
        token_hash: tokenHash,
        used: false,
        expires_at: { $gt: now }
      },
      {
        $set: {
          used: true,
          used_at: now,
          used_by_ip: clientIp
        }
      },
      { returnDocument: 'before' }
    );

    // Support both MongoDB v4/v5/v6 result structures (result.value vs result directly)
    const claimedRecord = (result && result.value) ? result.value : result;

    if (!claimedRecord) {
      // Check if it exists but expired or already used for explicit error
      const existing = await db.collection('admin_reset_tokens').findOne({ token_hash: tokenHash });
      if (existing && existing.used) {
        return sendJson(res, 400, {
          ok: false,
          category: 'token_already_used',
          error: 'This reset link has already been used. Please request a new link.'
        });
      }
      if (existing && existing.expires_at <= now) {
        return sendJson(res, 400, {
          ok: false,
          category: 'token_expired',
          error: 'This reset link has expired (15-minute validity). Please request a new link.'
        });
      }
      return sendJson(res, 400, {
        ok: false,
        category: 'token_invalid',
        error: 'This reset link is invalid or has expired. Please request a new link.'
      });
    }

    // Atomically update authoritative PIN and increment session_version to invalidate all active sessions
    const newHash = hashPin(pin);
    await db.collection('admin_settings').updateOne(
      { _id: 'admin_pin_config' },
      {
        $set: {
          pin_hash: newHash,
          updated_at: now,
          updated_by: 'email_reset'
        },
        $inc: {
          session_version: 1
        }
      },
      { upsert: true }
    );

    // Clear failed login lockouts
    await clearAllLockouts(db);

    console.log('[Auth Reset] PIN updated in MongoDB Atlas. Sessions invalidated across all devices.');
    return sendJson(res, 200, {
      ok: true,
      category: 'pin_reset_verified',
      message: 'PIN updated successfully in MongoDB Atlas. You can now log in across all devices with your new PIN.'
    });
  } catch (err) {
    console.error('[Complete Reset Error]', err.message);
    return sendJson(res, 500, {
      ok: false,
      error: 'An internal error occurred while finalizing the PIN reset.'
    });
  }
};
