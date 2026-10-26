/**
 * Cryptographic Password Hashing & Signed HttpOnly Session Management
 * 
 * - scrypt cryptographic password hashing with 16-byte random salt and timing-safe equality
 * - Signed HMAC-SHA256 session tokens with session versioning
 * - Secure, HttpOnly, SameSite=Lax cookie serialization
 */

const crypto = require('crypto');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 64;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const COOKIE_NAME = 'invgen_session';

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.trim().length < 16) {
    // If running in development without a secret, use a deterministic dev fallback
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET environment variable must be at least 16 characters in production.');
    }
    return 'insecure-dev-fallback-session-secret-change-in-production!';
  }
  return secret.trim();
}

function hashPin(pin) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin.trim())) {
    throw new Error('PIN must be exactly 4 digits.');
  }
  const cleanPin = pin.trim();
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(cleanPin, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${derived.toString('hex')}`;
}

function verifyPin(pin, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || typeof pin !== 'string') {
    return false;
  }
  const cleanPin = pin.trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    return false;
  }

  if (storedHash.startsWith('scrypt:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 6) return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = parts[4];
    const keyHex = parts[5];

    const derived = crypto.scryptSync(cleanPin, salt, SCRYPT_KEY_LEN, { N, r, p });
    const expectedBuf = Buffer.from(keyHex, 'hex');
    if (expectedBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuf);
  }

  return false;
}

function signSession(sessionVersion) {
  const secret = getSessionSecret();
  const now = Date.now();
  const payload = {
    sub: 'admin',
    v: sessionVersion || 1,
    iat: now,
    exp: now + SESSION_TTL_MS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifySession(token, expectedSessionVersion) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  const secret = getSessionSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  const bufA = Buffer.from(signature);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload || payload.sub !== 'admin') return null;
    if (Date.now() > payload.exp) return null;

    // Invalidate session if session version does not match current DB version (e.g. after PIN reset)
    if (expectedSessionVersion !== undefined && payload.v !== expectedSessionVersion) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const list = {};
  const header = req.headers.cookie;
  if (!header) return list;

  header.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts.shift().trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
}

function createSessionCookie(token, isSecure = false) {
  const secureFlag = isSecure ? '; Secure' : '';
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
}

function clearSessionCookie(isSecure = false) {
  const secureFlag = isSecure ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
}

function isRequestSecure(req) {
  if (process.env.NODE_ENV === 'production') return true;
  const proto = req.headers['x-forwarded-proto'];
  return proto === 'https' || req.socket?.encrypted === true;
}

function attachCookie(res, cookieStr) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookieStr);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', [existing, cookieStr]);
  }
}

module.exports = {
  hashPin,
  verifyPin,
  signSession,
  verifySession,
  parseCookies,
  createSessionCookie,
  clearSessionCookie,
  isRequestSecure,
  attachCookie,
  COOKIE_NAME
};
