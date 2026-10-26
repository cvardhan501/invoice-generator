/**
 * POST /api/auth/change-pin
 * Authenticated PIN change endpoint.
 * Requires verification of current PIN, updates hash, and increments session_version to invalidate old sessions.
 */

const { connectToDatabase } = require('../../lib/mongodb');
const { hashPin, verifyPin, signSession, createSessionCookie, isRequestSecure, attachCookie } = require('../../lib/auth');
const { validatePin, readJsonBody, sendJson } = require('../../lib/validation');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed. Use POST.' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'Invalid JSON request payload.' });
  }

  const { currentPin, newPin } = body;
  if (!validatePin(currentPin) || !validatePin(newPin)) {
    return sendJson(res, 400, {
      ok: false,
      category: 'pin_invalid',
      error: 'Both current and new PINs must be exactly 4 numeric digits.'
    });
  }

  if (currentPin === newPin) {
    return sendJson(res, 400, {
      ok: false,
      error: 'New PIN must be different from current PIN.'
    });
  }

  let db;
  try {
    const conn = await connectToDatabase();
    db = conn.db;
  } catch (err) {
    console.error('[Change PIN DB Error]', err.message);
    return sendJson(res, 503, {
      ok: false,
      category: 'database_unavailable',
      error: 'Authentication database is unreachable.'
    });
  }

  try {
    const settings = await db.collection('admin_settings').findOne({ _id: 'admin_pin_config' });
    if (!settings || !settings.pin_hash) {
      return sendJson(res, 400, {
        ok: false,
        category: 'not_configured',
        error: 'Administrator PIN has not been initialized.'
      });
    }

    if (!verifyPin(currentPin, settings.pin_hash)) {
      return sendJson(res, 401, {
        ok: false,
        category: 'invalid_current_pin',
        error: 'Current PIN is incorrect.'
      });
    }

    const newHash = hashPin(newPin);
    const newSessionVersion = (settings.session_version || 1) + 1;
    const now = new Date();

    await db.collection('admin_settings').updateOne(
      { _id: 'admin_pin_config' },
      {
        $set: {
          pin_hash: newHash,
          session_version: newSessionVersion,
          updated_at: now,
          updated_by: 'authenticated_change'
        }
      }
    );

    // Issue refreshed session cookie for this browser
    const token = signSession(newSessionVersion);
    attachCookie(res, createSessionCookie(token, isRequestSecure(req)));

    return sendJson(res, 200, {
      ok: true,
      message: 'PIN changed successfully across all devices.'
    });
  } catch (err) {
    console.error('[Change PIN Error]', err.message);
    return sendJson(res, 500, {
      ok: false,
      error: 'Internal server error while changing PIN.'
    });
  }
};
