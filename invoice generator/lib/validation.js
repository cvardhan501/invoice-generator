/**
 * Validation & HTTP Request/Response Utilities
 * Safe parsing, size limits, input validation, and normalized JSON responses for Vercel & Node.
 */

function validatePin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin.trim());
}

function validateResetToken(token) {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token.trim());
}

function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function readJsonBody(req) {
  // If Vercel has already parsed body as an object, return it directly
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  // If Vercel provided body as a string, parse it
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      throw new Error('Invalid JSON payload');
    }
  }

  // In Node standard request streaming
  return new Promise((resolve, reject) => {
    let raw = '';
    let exceeded = false;
    req.on('data', chunk => {
      if (exceeded) return;
      raw += chunk;
      if (raw.length > 16384) { // 16KB limit
        exceeded = true;
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (exceeded) return;
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Invalid JSON structure');
        }
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data, headers = {}) {
  // Support Vercel res.status().json() if present
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    return res.status(statusCode).json(data);
  }

  // Fallback to standard Node.js ServerResponse
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(data));
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

module.exports = {
  validatePin,
  validateResetToken,
  validateEmail,
  readJsonBody,
  sendJson,
  getClientIp
};
