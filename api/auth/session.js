/**
 * GET /api/auth/session
 * Verifies if the incoming request has a valid, active session.
 */

const { connectToDatabase } = require('../../lib/mongodb');
const { parseCookies, verifySession, COOKIE_NAME } = require('../../lib/auth');
const { sendJson } = require('../../lib/validation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed. Use GET.' });
  }

  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) {
    return sendJson(res, 401, { ok: false, authenticated: false, error: 'No active session.' });
  }

  try {
    const { db } = await connectToDatabase();
    const settings = await db.collection('admin_settings').findOne({ _id: 'admin_pin_config' });
    if (!settings) {
      return sendJson(res, 401, { ok: false, authenticated: false, error: 'Administrator not configured.' });
    }

    const payload = verifySession(token, settings.session_version || 1);
    if (!payload) {
      return sendJson(res, 401, { ok: false, authenticated: false, error: 'Session expired or invalidated.' });
    }

    return sendJson(res, 200, {
      ok: true,
      authenticated: true,
      user: 'admin',
      expiresAt: payload.exp
    });
  } catch (err) {
    console.error('[Session Check Error]', err.message);
    return sendJson(res, 503, {
      ok: false,
      category: 'database_unavailable',
      error: 'Authentication database unreachable.'
    });
  }
};
