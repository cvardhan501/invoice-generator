/**
 * POST /api/auth/setup
 * First-run administrator PIN initialization on MongoDB Atlas.
 * Enforces:
 * - One-time execution: permanently fails with 403 if PIN is already configured
 * - ADMIN_SETUP_SECRET authorization check if configured in environment
 * - Atomic persistence to MongoDB Atlas
 */

const crypto = require('crypto');
const { connectToDatabase } = require('../../lib/mongodb');
const { hashPin, signSession, createSessionCookie, isRequestSecure, attachCookie } = require('../../lib/auth');
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

  const { pin } = body;
  if (!validatePin(pin)) {
    return sendJson(res, 400, {
      ok: false,
      category: 'pin_invalid',
      error: 'PIN must be exactly 4 numeric digits.'
    });
  }

  // Extract setup secret from all standard JSON body keys and request headers
  const authHeader = req.headers['authorization'] || '';
  const bearerSecret = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

  const providedSecret = (
    body.setupSecret ||
    body.setup_secret ||
    body.secret ||
    body.adminSetupSecret ||
    req.headers['x-setup-secret'] ||
    req.headers['x-admin-setup-secret'] ||
    bearerSecret ||
    ''
  ).toString().trim();

  // If ADMIN_SETUP_SECRET is configured in environment, require authorized verification
  const configuredSecret = (process.env.ADMIN_SETUP_SECRET || '').trim();
  if (configuredSecret) {
    let isAuthorized = false;
    if (providedSecret) {
      const bufA = Buffer.from(providedSecret);
      const bufB = Buffer.from(configuredSecret);
      if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return sendJson(res, 401, {
        ok: false,
        category: 'unauthorized',
        error: 'Invalid or missing administrator setup secret.'
      });
    }
  }

  let db;
  try {
    const conn = await connectToDatabase();
    db = conn.db;
  } catch (err) {
    console.error('[Setup DB Error]', err.message);
    return sendJson(res, 503, {
      ok: false,
      category: 'database_unavailable',
      error: 'Authentication database is unreachable.'
    });
  }

  try {
    const existing = await db.collection('admin_settings').findOne({ _id: 'admin_pin_config' });
    if (existing && existing.pin_hash) {
      return sendJson(res, 403, {
        ok: false,
        category: 'already_configured',
        error: 'Administrator PIN has already been initialized on this server. Use the email reset flow to change the PIN.'
      });
    }

    const pinHash = hashPin(pin);
    const now = new Date();

    await db.collection('admin_settings').updateOne(
      { _id: 'admin_pin_config' },
      {
        $set: {
          pin_hash: pinHash,
          session_version: 1,
          updated_at: now,
          created_at: now,
          updated_by: 'initial_setup'
        }
      },
      { upsert: true }
    );

    // Issue initial session cookie
    const token = signSession(1);
    attachCookie(res, createSessionCookie(token, isRequestSecure(req)));

    console.log('[Auth Setup] Administrator PIN initialized successfully on MongoDB Atlas.');
    return sendJson(res, 200, {
      ok: true,
      category: 'setup_success',
      message: 'Administrator PIN configured successfully on MongoDB Atlas.'
    });
  } catch (err) {
    console.error('[Setup Error]', err.message);
    return sendJson(res, 500, {
      ok: false,
      error: 'Failed to initialize administrator settings.'
    });
  }
};
