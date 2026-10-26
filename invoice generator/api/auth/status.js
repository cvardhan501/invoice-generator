/**
 * GET /api/auth/status
 * Informs frontend whether the administrator PIN is configured and if the current session is authenticated.
 */

const { connectToDatabase } = require('../../lib/mongodb');
const { parseCookies, verifySession, COOKIE_NAME } = require('../../lib/auth');
const { sendJson } = require('../../lib/validation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed. Use GET.' });
  }

  try {
    const { db } = await connectToDatabase();
    const settings = await db.collection('admin_settings').findOne({ _id: 'admin_pin_config' });
    const isConfigured = Boolean(settings && settings.pin_hash);

    let authenticated = false;
    if (isConfigured) {
      const cookies = parseCookies(req);
      const token = cookies[COOKIE_NAME];
      if (token) {
        const session = verifySession(token, settings.session_version || 1);
        if (session) authenticated = true;
      }
    }

    return sendJson(res, 200, {
      ok: true,
      isConfigured,
      authenticated,
      setupSecretRequired: Boolean(process.env.ADMIN_SETUP_SECRET && process.env.ADMIN_SETUP_SECRET.trim()),
      updatedAt: settings ? settings.updated_at : null
    });
  } catch (err) {
    console.error('[Auth Status Error]', err.message);
    return sendJson(res, 503, {
      ok: false,
      category: 'database_unavailable',
      error: 'Authentication database is unreachable. Fail-closed.'
    });
  }
};
