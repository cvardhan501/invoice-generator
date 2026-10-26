/**
 * Local Development Server for Invoice Generator
 * 
 * Provides 100% parity with Vercel Serverless Functions:
 * - Directly invokes Vercel API function handlers under /api/auth/*
 * - Serves static frontend assets from /public/
 * - Supports CORS for optional VS Code Live Server testing on port 5500
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

// Permitted CORS origins for local development
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  APP_BASE_URL
]);

// Map API routes to Vercel serverless function handlers
const API_ROUTES = {
  '/api/auth/status': require('./api/auth/status'),
  '/api/auth-status': require('./api/auth/status'),
  '/api/auth/login': require('./api/auth/login'),
  '/api/verify-pin': require('./api/auth/login'),
  '/api/auth/setup': require('./api/auth/setup'),
  '/api/initialize-pin': require('./api/auth/setup'),
  '/api/auth/request-reset': require('./api/auth/request-reset'),
  '/api/request-pin-reset': require('./api/auth/request-reset'),
  '/api/auth/complete-reset': require('./api/auth/complete-reset'),
  '/api/complete-pin-reset': require('./api/auth/complete-reset'),
  '/api/auth/session': require('./api/auth/session'),
  '/api/auth/logout': require('./api/auth/logout'),
  '/api/auth/change-pin': require('./api/auth/change-pin')
};

const STATIC_FILES_MAP = new Map([
  ['', 'index.html'],
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/invoice generator.html', 'index.html'],
  ['/reset-pin.html', 'reset-pin.html'],
  ['/invoice generator app logo.png', 'Invoice Generator App Logo.png'],
  ['/favicon.ico', 'favicon.ico']
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400);
    return res.end('Invalid URL');
  }

  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Setup-Secret, X-Admin-Setup-Secret, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // API Route Dispatcher
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (pathname.startsWith('/api/')) {
    const handler = API_ROUTES[pathname];
    if (handler) {
      try {
        await handler(req, res);
      } catch (err) {
        console.error(`[API Handler Error ${pathname}]`, err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Internal server error.' }));
        }
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'API endpoint not found.' }));
  }

  // Static File Server (serves from public/)
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Invalid path');
  }

  const targetFile = STATIC_FILES_MAP.get(decodedPath);
  if (!targetFile) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  const targetPath = path.join(PUBLIC_DIR, targetFile);
  fs.readFile(targetPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(targetPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Invoice Generator dev server listening on http://localhost:${PORT}`);
    console.log(`Vercel API routes loaded: ${Object.keys(API_ROUTES).filter(r => !r.includes('-')).length} endpoints active`);
    console.log(`Static assets served from: ${PUBLIC_DIR}`);
  });
}

module.exports = { server, API_ROUTES };
