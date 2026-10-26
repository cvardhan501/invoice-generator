/**
 * POST /api/auth/logout
 * Clears the HttpOnly administrator session cookie.
 */

const { clearSessionCookie, isRequestSecure, attachCookie } = require('../../lib/auth');
const { sendJson } = require('../../lib/validation');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed. Use POST.' });
  }

  const cookieStr = clearSessionCookie(isRequestSecure(req));
  attachCookie(res, cookieStr);

  return sendJson(res, 200, {
    ok: true,
    message: 'Logged out successfully.'
  });
};
