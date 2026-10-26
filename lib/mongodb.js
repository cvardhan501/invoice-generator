/**
 * MongoDB Atlas Connection Pool & Database Client
 * Designed for Vercel Serverless Functions with connection caching.
 */

const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;
let mockDb = null;

async function ensureIndexes(db) {
  try {
    const settingsCollection = db.collection('admin_settings');
    // Ensure admin_settings has unique _id for single config
    await settingsCollection.createIndex({ _id: 1 });

    const tokensCollection = db.collection('admin_reset_tokens');
    // Ensure unique token_hash to prevent duplicate tokens
    await tokensCollection.createIndex({ token_hash: 1 }, { unique: true });
    // MongoDB TTL index: automatically purges documents when expires_at has passed
    await tokensCollection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

    const lockoutsCollection = db.collection('admin_lockouts');
    await lockoutsCollection.createIndex({ ip: 1 }, { unique: true });
    await lockoutsCollection.createIndex({ locked_until: 1 }, { expireAfterSeconds: 0 });
  } catch (err) {
    // If index creation fails due to permissions, log warning but don't crash
    console.warn('[MongoDB] Index creation warning:', err.message);
  }
}

let envLoaded = false;
function tryLoadEnv() {
  if (envLoaded || process.env.NODE_ENV === 'test') return;
  envLoaded = true;
  if (process.env.MONGODB_URI) return;
  const fs = require('fs');
  const path = require('path');
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', 'invoice generator', '.env'),
    path.join(process.cwd(), 'invoice generator', '.env')
  ];
  for (const envFile of candidates) {
    if (fs.existsSync(envFile)) {
      try {
        const content = fs.readFileSync(envFile, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
          if (m && process.env[m[1]] === undefined) {
            process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
          }
        }
      } catch {}
      if (process.env.MONGODB_URI) break;
    }
  }
}

async function connectToDatabase() {
  // Allow test suite or mock environment to inject in-memory mock DB
  if (mockDb) {
    return { client: null, db: mockDb };
  }

  tryLoadEnv();

  const uri = process.env.MONGODB_URI;
  if (!uri || !uri.trim()) {
    const error = new Error('MONGODB_URI environment variable is missing.');
    error.code = 'ERR_MISSING_MONGODB_URI';
    throw error;
  }

  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  try {
    await client.connect();
  } catch (connectErr) {
    let sanitizedMsg = connectErr.message || 'Database connection error';
    if (uri) {
      sanitizedMsg = sanitizedMsg.replace(/mongodb(?:\+srv)?:\/\/[^@]+@/gi, 'mongodb+srv://[credentials]@');
    }
    const safeErr = new Error(`Database connection failed: ${sanitizedMsg}`);
    safeErr.code = connectErr.code || 'ERR_MONGODB_CONNECTION';
    throw safeErr;
  }

  const dbName = process.env.MONGODB_DB || 'invoice_generator_auth';
  const db = client.db(dbName);

  await ensureIndexes(db);

  cachedClient = client;
  cachedDb = db;
  return { client: cachedClient, db: cachedDb };
}

function setMockDb(mock) {
  mockDb = mock;
  if (!mock) {
    cachedClient = null;
    cachedDb = null;
  }
}

function clearCache() {
  if (cachedClient) {
    try { cachedClient.close(); } catch {}
  }
  cachedClient = null;
  cachedDb = null;
  mockDb = null;
}

module.exports = {
  connectToDatabase,
  setMockDb,
  clearCache
};
