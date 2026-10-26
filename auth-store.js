/**
 * Authoritative Server-Side PIN Authentication Store
 * 
 * Implements:
 * - Scrypt password hashing with cryptographic salt and timing-safe comparison
 * - Transactional persistence: Native SQLite (node:sqlite) with atomic JSON fallback
 * - Failed-attempt tracking and progressive lockout (5 failed attempts = 5 min lockout)
 * - Safe legacy fnv1a migration with automatic upgrade to scrypt
 * - Exclusively server-side authority: no hashes exposed to clients
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, '.admin-auth.db');
const JSON_FILE = path.join(ROOT, '.admin-auth.json');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 64;

// Lockout settings: 5 failed attempts within 15 minutes triggers a 5 minute lockout
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;

class AuthStore {
  constructor() {
    this.useSqlite = false;
    this.sqliteDb = null;
    this.failedAttempts = new Map(); // ip -> { count, windowStart, lockedUntil }
    this.initDatabase();
  }

  initDatabase() {
    try {
      const { DatabaseSync } = require('node:sqlite');
      this.sqliteDb = new DatabaseSync(DB_FILE);
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS admin_auth (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          pin_hash TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          updated_by TEXT NOT NULL
        );
      `);
      this.useSqlite = true;
    } catch (err) {
      this.useSqlite = false;
      this.sqliteDb = null;
    }
  }

  hashPin(pin) {
    if (!/^\d{4}$/.test(pin)) {
      throw new Error('PIN must be exactly 4 numeric digits.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(pin, salt, SCRYPT_KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    });
    return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${derivedKey.toString('hex')}`;
  }

  verifyPinHash(pin, storedHash) {
    if (!storedHash || typeof storedHash !== 'string' || !/^\d{4}$/.test(pin)) {
      return false;
    }

    if (storedHash.startsWith('scrypt:')) {
      const parts = storedHash.split(':');
      if (parts.length !== 6) return false;
      const N = Number(parts[1]);
      const r = Number(parts[2]);
      const p = Number(parts[3]);
      const salt = parts[4];
      const expectedKeyHex = parts[5];

      const derivedKey = crypto.scryptSync(pin, salt, SCRYPT_KEY_LEN, { N, r, p });
      const expectedBuffer = Buffer.from(expectedKeyHex, 'hex');
      if (expectedBuffer.length !== derivedKey.length) return false;
      return crypto.timingSafeEqual(derivedKey, expectedBuffer);
    }

    // Legacy migration check for fnv1a hashes
    if (storedHash.startsWith('fnv1a-')) {
      let h = 2166136261;
      for (let i = 0; i < pin.length; i++) {
        h ^= pin.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const legacyCalculated = 'fnv1a-' + (h >>> 0).toString(16).padStart(8, '0');
      const bufA = Buffer.from(storedHash);
      const bufB = Buffer.from(legacyCalculated);
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    }

    return false;
  }

  getRecord() {
    if (this.useSqlite && this.sqliteDb) {
      try {
        const stmt = this.sqliteDb.prepare('SELECT pin_hash, updated_at, updated_by FROM admin_auth WHERE id = 1');
        const row = stmt.get();
        if (row) {
          return {
            pinHash: row.pin_hash,
            updatedAt: row.updated_at,
            updatedBy: row.updated_by
          };
        }
      } catch (err) {
        // Fall back to JSON if sqlite read error occurs
      }
    }

    try {
      if (fs.existsSync(JSON_FILE)) {
        const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
        if (data && data.pinHash) return data;
      }
    } catch {}

    return null;
  }

  setPin(pin, updatedBy = 'system') {
    const pinHash = this.hashPin(pin);
    const now = Date.now();

    if (this.useSqlite && this.sqliteDb) {
      try {
        const stmt = this.sqliteDb.prepare(`
          INSERT INTO admin_auth (id, pin_hash, updated_at, updated_by)
          VALUES (1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            pin_hash = excluded.pin_hash,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `);
        stmt.run(pinHash, now, updatedBy);
      } catch (err) {
        console.error('SQLite write error, saving to JSON fallback:', err.message);
        this.writeJsonFile({ pinHash, updatedAt: now, updatedBy });
      }
    } else {
      this.writeJsonFile({ pinHash, updatedAt: now, updatedBy });
    }

    // Clear failed attempt lockouts whenever PIN is successfully changed/initialized
    this.resetAllLockouts();

    return { updatedAt: now, updatedBy };
  }

  writeJsonFile(data) {
    const tmp = `${JSON_FILE}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      try {
        if (fs.existsSync(JSON_FILE)) fs.unlinkSync(JSON_FILE);
      } catch {}
      fs.renameSync(tmp, JSON_FILE);
    } catch {
      fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    }
  }

  isConfigured() {
    const rec = this.getRecord();
    return Boolean(rec && rec.pinHash);
  }

  verify(pin) {
    const rec = this.getRecord();
    if (!rec || !rec.pinHash) return false;

    const isValid = this.verifyPinHash(pin, rec.pinHash);
    if (isValid && rec.pinHash.startsWith('fnv1a-')) {
      // Seamlessly upgrade legacy hash to scrypt
      this.setPin(pin, 'legacy-migration-upgrade');
    }
    return isValid;
  }

  getMetadata() {
    const rec = this.getRecord();
    return {
      isConfigured: Boolean(rec && rec.pinHash),
      updatedAt: rec ? rec.updatedAt : null,
      updatedBy: rec ? rec.updatedBy : null
    };
  }

  // --- Rate Limiting & Lockout Management ---

  checkLockout(ip) {
    const now = Date.now();
    const entry = this.failedAttempts.get(ip);
    if (!entry) return { locked: false, remainingSeconds: 0, attemptsRemaining: MAX_FAILED_ATTEMPTS };

    if (entry.lockedUntil && entry.lockedUntil > now) {
      const remainingSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
      return { locked: true, remainingSeconds, attemptsRemaining: 0 };
    }

    // If window expired, reset
    if (now - entry.windowStart > ATTEMPT_WINDOW_MS) {
      this.failedAttempts.delete(ip);
      return { locked: false, remainingSeconds: 0, attemptsRemaining: MAX_FAILED_ATTEMPTS };
    }

    const attemptsRemaining = Math.max(0, MAX_FAILED_ATTEMPTS - entry.count);
    return { locked: false, remainingSeconds: 0, attemptsRemaining };
  }

  recordFailedAttempt(ip) {
    const now = Date.now();
    let entry = this.failedAttempts.get(ip);

    if (!entry || now - entry.windowStart > ATTEMPT_WINDOW_MS) {
      entry = { count: 1, windowStart: now, lockedUntil: 0 };
    } else {
      entry.count += 1;
    }

    if (entry.count >= MAX_FAILED_ATTEMPTS) {
      entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    }

    this.failedAttempts.set(ip, entry);

    const remainingSeconds = entry.lockedUntil ? Math.ceil((entry.lockedUntil - now) / 1000) : 0;
    const attemptsRemaining = Math.max(0, MAX_FAILED_ATTEMPTS - entry.count);

    return {
      locked: Boolean(entry.lockedUntil && entry.lockedUntil > now),
      remainingSeconds,
      attemptsRemaining
    };
  }

  resetFailedAttempts(ip) {
    this.failedAttempts.delete(ip);
  }

  resetAllLockouts() {
    this.failedAttempts.clear();
  }

  resetStoreForTesting() {
    if (this.useSqlite && this.sqliteDb) {
      try {
        this.sqliteDb.exec('DELETE FROM admin_auth;');
      } catch {}
    }
    try {
      if (fs.existsSync(JSON_FILE)) fs.unlinkSync(JSON_FILE);
    } catch {}
    this.resetAllLockouts();
  }
}

const authStore = new AuthStore();
module.exports = { authStore, AuthStore };
