/**
 * Rate Limiting & Brute-Force Lockout Protection
 * Uses in-memory caching with MongoDB backing for Vercel Serverless Function persistence.
 */

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 5 * 60 * 1000;  // 5 minutes

// In-memory cache for fast local checks within the same instance
const memoryStore = new Map();

async function checkRateLimit(ip, db) {
  const now = Date.now();

  // 1. Check in-memory first
  const mem = memoryStore.get(ip);
  if (mem && mem.locked_until && mem.locked_until > now) {
    const remainingSeconds = Math.ceil((mem.locked_until - now) / 1000);
    return { locked: true, remainingSeconds, attemptsRemaining: 0 };
  }

  // 2. Check MongoDB for cross-instance state
  if (db) {
    try {
      const doc = await db.collection('admin_lockouts').findOne({ ip });
      if (doc && doc.locked_until && new Date(doc.locked_until).getTime() > now) {
        const remainingSeconds = Math.ceil((new Date(doc.locked_until).getTime() - now) / 1000);
        memoryStore.set(ip, {
          attempts: doc.attempts,
          locked_until: new Date(doc.locked_until).getTime()
        });
        return { locked: true, remainingSeconds, attemptsRemaining: 0 };
      }
    } catch {}
  }

  const attempts = mem ? mem.attempts : 0;
  const attemptsRemaining = Math.max(0, MAX_FAILED_ATTEMPTS - attempts);
  return { locked: false, remainingSeconds: 0, attemptsRemaining };
}

async function recordFailure(ip, db) {
  const now = Date.now();
  let mem = memoryStore.get(ip);
  if (!mem || (now - mem.window_start > WINDOW_MS)) {
    mem = { attempts: 1, window_start: now, locked_until: 0 };
  } else {
    mem.attempts += 1;
  }

  let locked = false;
  let remainingSeconds = 0;
  if (mem.attempts >= MAX_FAILED_ATTEMPTS) {
    mem.locked_until = now + LOCKOUT_MS;
    locked = true;
    remainingSeconds = Math.ceil(LOCKOUT_MS / 1000);
  }

  memoryStore.set(ip, mem);

  if (db) {
    try {
      const lockedUntilDate = mem.locked_until ? new Date(mem.locked_until) : null;
      await db.collection('admin_lockouts').updateOne(
        { ip },
        {
          $set: {
            attempts: mem.attempts,
            window_start: new Date(mem.window_start),
            locked_until: lockedUntilDate,
            updated_at: new Date()
          }
        },
        { upsert: true }
      );
    } catch {}
  }

  return {
    locked,
    remainingSeconds,
    attemptsRemaining: Math.max(0, MAX_FAILED_ATTEMPTS - mem.attempts)
  };
}

async function clearFailures(ip, db) {
  memoryStore.delete(ip);
  if (db) {
    try {
      await db.collection('admin_lockouts').deleteOne({ ip });
    } catch {}
  }
}

async function clearAllLockouts(db) {
  memoryStore.clear();
  if (db) {
    try {
      await db.collection('admin_lockouts').deleteMany({});
    } catch {}
  }
}

module.exports = {
  checkRateLimit,
  recordFailure,
  clearFailures,
  clearAllLockouts,
  MAX_FAILED_ATTEMPTS
};
