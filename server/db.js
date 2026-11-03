// db.js - Dual-Mode Persistent Database Adapter
// Supports PostgreSQL (via Neon / Render when DATABASE_URL is set)
// and an atomic persistent local store for local development.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();
const { Pool } = require('pg');

let pool = null;
const isPostgres = Boolean(process.env.DATABASE_URL);

if (isPostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
}

// Local file store fallback
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

let localStore = {
  slots: [],
  bookings: [],
  idempotency: {},
  rateLimits: [] // { email, timestamp }
};

if (!isPostgres) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(DATA_FILE)) {
    try {
      localStore = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
      // Use defaults if corrupted
    }
  }
}

function saveLocal() {
  if (!isPostgres) {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(localStore, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save local store:', e.message);
    }
  }
}

// Initialize tables in PostgreSQL
async function initDb() {
  if (isPostgres) {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS slots (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          start_time TIMESTAMPTZ NOT NULL,
          end_time TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          slot_id TEXT NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );

        -- Level 3 Concurrency: Guaranteed no two confirmed bookings for the same slot
        CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_slot 
        ON bookings (slot_id) 
        WHERE status = 'confirmed';

        -- Level 4 Idempotency Key table
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT PRIMARY KEY,
          request_hash TEXT NOT NULL,
          status_code INT NOT NULL,
          response_body JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );

        -- Level 5 Rate Limiting table
        CREATE TABLE IF NOT EXISTS rate_limits (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          attempted_at TIMESTAMPTZ NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rate_limits_email_time ON rate_limits (email, attempted_at);
        CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings (email, created_at);
      `);

      // Seed default slots if completely empty so frontend is immediately interactive
      const countRes = await client.query('SELECT COUNT(*) as count FROM slots');
      if (parseInt(countRes.rows[0].count, 10) === 0) {
        await seedDefaultSlots(client);
      }
      console.log('PostgreSQL database initialized successfully.');
    } finally {
      client.release();
    }
  } else {
    if (localStore.slots.length === 0) {
      seedDefaultSlotsLocal();
    }
    console.log('Using local persistent file store (data/store.json).');
  }
}

async function seedDefaultSlots(client) {
  const tomorrow = new Date(Date.now() + 86400000);
  const dayAfter = new Date(Date.now() + 172800000);
  
  const defaults = [
    { id: 's1', provider: 'Dr Ade', start: new Date(tomorrow.setHours(9, 0, 0, 0)).toISOString(), end: new Date(tomorrow.setHours(9, 30, 0, 0)).toISOString() },
    { id: 's2', provider: 'Dr Ade', start: new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString(), end: new Date(tomorrow.setHours(10, 30, 0, 0)).toISOString() },
    { id: 's3', provider: 'Dr Okon', start: new Date(tomorrow.setHours(13, 0, 0, 0)).toISOString(), end: new Date(tomorrow.setHours(13, 45, 0, 0)).toISOString() },
    { id: 's4', provider: 'Dr Okon', start: new Date(tomorrow.setHours(14, 30, 0, 0)).toISOString(), end: new Date(tomorrow.setHours(15, 15, 0, 0)).toISOString() },
    { id: 's5', provider: 'Dr Bello', start: new Date(dayAfter.setHours(8, 30, 0, 0)).toISOString(), end: new Date(dayAfter.setHours(9, 0, 0, 0)).toISOString() },
    { id: 's6', provider: 'Dr Mensah', start: new Date(dayAfter.setHours(11, 0, 0, 0)).toISOString(), end: new Date(dayAfter.setHours(11, 30, 0, 0)).toISOString() }
  ];

  for (const s of defaults) {
    await client.query('INSERT INTO slots (id, provider, start_time, end_time) VALUES ($1, $2, $3, $4)', [s.id, s.provider, s.start, s.end]);
  }
}

function seedDefaultSlotsLocal() {
  const tomorrow = new Date(Date.now() + 86400000);
  const dayAfter = new Date(Date.now() + 172800000);
  localStore.slots = [
    { id: 's1', provider: 'Dr Ade', start: new Date(tomorrow.setHours(9, 0, 0, 0)).toISOString(), end: new Date(tomorrow.setHours(9, 30, 0, 0)).toISOString() },
    { id: 's2', provider: 'Dr Ade', start: new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString(), end: new Date(tomorrow.setHours(10, 30, 0, 0)).toISOString() },
    { id: 's3', provider: 'Dr Okon', start: new Date(tomorrow.setHours(13, 0, 0, 0)).toISOString(), end: new Date(tomorrow.setHours(13, 45, 0, 0)).toISOString() },
    { id: 's4', provider: 'Dr Okon', start: new Date(tomorrow.setHours(14, 30, 0, 0)).toISOString(), end: new Date(tomorrow.setHours(15, 15, 0, 0)).toISOString() },
    { id: 's5', provider: 'Dr Bello', start: new Date(dayAfter.setHours(8, 30, 0, 0)).toISOString(), end: new Date(dayAfter.setHours(9, 0, 0, 0)).toISOString() },
    { id: 's6', provider: 'Dr Mensah', start: new Date(dayAfter.setHours(11, 0, 0, 0)).toISOString(), end: new Date(dayAfter.setHours(11, 30, 0, 0)).toISOString() }
  ];
  saveLocal();
}

// 1. Reset all slots and bookings (Level 1)
async function resetSlots(slots) {
  if (isPostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM bookings');
      await client.query('DELETE FROM slots');
      await client.query('DELETE FROM idempotency_keys');
      await client.query('DELETE FROM rate_limits');

      for (const slot of slots) {
        await client.query(
          'INSERT INTO slots (id, provider, start_time, end_time) VALUES ($1, $2, $3, $4)',
          [slot.id, slot.provider, slot.start, slot.end]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } else {
    localStore.bookings = [];
    localStore.idempotency = {};
    localStore.rateLimits = [];
    localStore.slots = slots.map(s => ({
      id: s.id,
      provider: s.provider,
      start: s.start,
      end: s.end
    }));
    saveLocal();
  }
}

// 2. Get all slots sorted by start asc, with available flag (Level 1)
async function getSlots(providerFilter) {
  if (isPostgres) {
    let query = `
      SELECT 
        s.id, 
        s.provider, 
        to_char(s.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as start,
        to_char(s.end_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as end,
        (b.id IS NULL) as available
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
    `;
    const params = [];
    if (providerFilter) {
      query += ` WHERE s.provider = $1`;
      params.push(providerFilter);
    }
    query += ` ORDER BY s.start_time ASC`;

    const res = await pool.query(query, params);
    return res.rows.map(r => ({
      id: r.id,
      provider: r.provider,
      start: r.start,
      end: r.end,
      available: Boolean(r.available)
    }));
  } else {
    let slots = [...localStore.slots];
    if (providerFilter) {
      slots = slots.filter(s => s.provider === providerFilter);
    }
    // Sort earliest start first
    slots.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    const activeBookings = new Set(
      localStore.bookings.filter(b => b.status === 'confirmed').map(b => b.slot_id)
    );

    return slots.map(s => ({
      id: s.id,
      provider: s.provider,
      start: s.start,
      end: s.end,
      available: !activeBookings.has(s.id)
    }));
  }
}

// Get single slot by ID
async function getSlotById(slotId) {
  if (isPostgres) {
    const res = await pool.query(
      `SELECT id, provider, 
        to_char(start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as start,
        to_char(end_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as end
       FROM slots WHERE id = $1`,
      [slotId]
    );
    return res.rows[0] || null;
  } else {
    return localStore.slots.find(s => s.id === slotId) || null;
  }
}

// 3. Level 5 Rate Limiting: At most 5 attempts per email per minute
async function recordAttemptAndCheckRateLimit(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const now = Date.now();
  const windowMs = 60 * 1000;
  const cutoff = new Date(now - windowMs);

  if (isPostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Count attempts in the last 60 seconds
      const countRes = await client.query(
        'SELECT COUNT(*) as count, MIN(attempted_at) as oldest FROM rate_limits WHERE email = $1 AND attempted_at >= $2',
        [normalizedEmail, cutoff.toISOString()]
      );
      const attemptCount = parseInt(countRes.rows[0].count, 10);

      // Record this attempt regardless of outcome
      await client.query(
        'INSERT INTO rate_limits (email, attempted_at) VALUES ($1, $2)',
        [normalizedEmail, new Date(now).toISOString()]
      );
      await client.query('COMMIT');

      if (attemptCount >= 5) {
        // Compute seconds until the oldest of the 5 window attempts expires
        const oldestTime = new Date(countRes.rows[0].oldest).getTime();
        const retryAfter = Math.max(1, Math.ceil((oldestTime + windowMs - now) / 1000));
        return { allowed: false, retryAfter };
      }
      return { allowed: true };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } else {
    // Clean old entries
    localStore.rateLimits = localStore.rateLimits.filter(
      r => r.email !== normalizedEmail || r.timestamp >= now - windowMs
    );
    const recent = localStore.rateLimits.filter(r => r.email === normalizedEmail);

    // Record this attempt
    localStore.rateLimits.push({ email: normalizedEmail, timestamp: now });
    saveLocal();

    if (recent.length >= 5) {
      const oldest = Math.min(...recent.map(r => r.timestamp));
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, retryAfter };
    }
    return { allowed: true };
  }
}

// 4. Level 4 Idempotency Check
async function getIdempotencyRecord(key) {
  if (!key) return null;
  if (isPostgres) {
    const res = await pool.query('SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE key = $1', [key]);
    if (res.rows.length === 0) return null;
    return {
      requestHash: res.rows[0].request_hash,
      statusCode: res.rows[0].status_code,
      responseBody: res.rows[0].response_body
    };
  } else {
    return localStore.idempotency[key] || null;
  }
}

async function saveIdempotencyRecord(key, requestHash, statusCode, responseBody) {
  if (!key) return;
  if (isPostgres) {
    await pool.query(
      `INSERT INTO idempotency_keys (key, request_hash, status_code, response_body, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO NOTHING`,
      [key, requestHash, statusCode, JSON.stringify(responseBody), new Date().toISOString()]
    );
  } else {
    localStore.idempotency[key] = { requestHash, statusCode, responseBody };
    saveLocal();
  }
}

// 5. Level 3 Concurrency Safe Booking Creation
async function createBooking({ id, slot_id, name, email }) {
  const createdAt = new Date().toISOString();

  if (isPostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if slot currently has a confirmed booking using row locking
      const existing = await client.query(
        'SELECT id FROM bookings WHERE slot_id = $1 AND status = $2 FOR UPDATE',
        [slot_id, 'confirmed']
      );

      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { conflict: true };
      }

      await client.query(
        `INSERT INTO bookings (id, slot_id, name, email, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, slot_id, name, email, 'confirmed', createdAt]
      );

      await client.query('COMMIT');
      return {
        booking: {
          id,
          slot_id,
          name,
          email,
          status: 'confirmed',
          created_at: createdAt
        }
      };
    } catch (err) {
      await client.query('ROLLBACK');
      // Postgres unique constraint violation code
      if (err.code === '23505') {
        return { conflict: true };
      }
      throw err;
    } finally {
      client.release();
    }
  } else {
    // Atomic check in local store
    const alreadyBooked = localStore.bookings.some(
      b => b.slot_id === slot_id && b.status === 'confirmed'
    );
    if (alreadyBooked) {
      return { conflict: true };
    }

    const booking = {
      id,
      slot_id,
      name,
      email,
      status: 'confirmed',
      created_at: createdAt
    };
    localStore.bookings.push(booking);
    saveLocal();
    return { booking };
  }
}

// 6. Get booking by ID (Level 1)
async function getBookingById(bookingId) {
  if (isPostgres) {
    const res = await pool.query(
      `SELECT id, slot_id, name, email, status, 
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
       FROM bookings WHERE id = $1`,
      [bookingId]
    );
    return res.rows[0] || null;
  } else {
    return localStore.bookings.find(b => b.id === bookingId) || null;
  }
}

// 7. Cancel a booking (Level 3)
async function cancelBooking(bookingId) {
  if (isPostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = $1 FOR UPDATE',
        [bookingId]
      );
      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }
      const current = res.rows[0];
      if (current.status === 'cancelled') {
        await client.query('ROLLBACK');
        return { alreadyCancelled: true };
      }

      await client.query('UPDATE bookings SET status = $1 WHERE id = $2', ['cancelled', bookingId]);
      await client.query('COMMIT');

      return {
        booking: {
          id: current.id,
          slot_id: current.slot_id,
          name: current.name,
          email: current.email,
          status: 'cancelled',
          created_at: new Date(current.created_at).toISOString()
        }
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } else {
    const booking = localStore.bookings.find(b => b.id === bookingId);
    if (!booking) return { notFound: true };
    if (booking.status === 'cancelled') return { alreadyCancelled: true };

    booking.status = 'cancelled';
    saveLocal();
    return { booking: { ...booking } };
  }
}

// 8. List a person's bookings with cursor pagination (Level 4)
async function getPersonBookings(email, limit = 10, cursor = null) {
  const normalizedEmail = email.toLowerCase().trim();

  if (isPostgres) {
    let query = `
      SELECT id, slot_id, name, email, status,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      FROM bookings
      WHERE LOWER(email) = LOWER($1)
    `;
    const params = [normalizedEmail];

    if (cursor) {
      // Cursor represents the last seen created_at + id
      const [cursorTime, cursorId] = cursor.split('__');
      query += ` AND (created_at > $2 OR (created_at = $2 AND id > $3))`;
      params.push(cursorTime, cursorId || '');
    }

    query += ` ORDER BY created_at ASC, id ASC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const res = await pool.query(query, params);
    const hasNext = res.rows.length > limit;
    const pageRows = res.rows.slice(0, limit);

    let next_cursor = null;
    if (hasNext && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      next_cursor = `${last.created_at}__${last.id}`;
    }

    return {
      bookings: pageRows.map(r => ({
        id: r.id,
        slot_id: r.slot_id,
        name: r.name,
        email: r.email,
        status: r.status,
        created_at: r.created_at
      })),
      next_cursor
    };
  } else {
    // Filter by case-insensitive email
    let matching = localStore.bookings.filter(
      b => b.email.toLowerCase() === normalizedEmail
    );

    // Oldest first
    matching.sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    let startIndex = 0;
    if (cursor) {
      const cursorIdx = matching.findIndex(b => `${b.created_at}__${b.id}` === cursor);
      if (cursorIdx !== -1) {
        startIndex = cursorIdx + 1;
      }
    }

    const pageItems = matching.slice(startIndex, startIndex + limit);
    const hasNext = startIndex + limit < matching.length;
    const next_cursor = hasNext && pageItems.length > 0
      ? `${pageItems[pageItems.length - 1].created_at}__${pageItems[pageItems.length - 1].id}`
      : null;

    return {
      bookings: pageItems,
      next_cursor
    };
  }
}

module.exports = {
  initDb,
  resetSlots,
  getSlots,
  getSlotById,
  recordAttemptAndCheckRateLimit,
  getIdempotencyRecord,
  saveIdempotencyRecord,
  createBooking,
  getBookingById,
  cancelBooking,
  getPersonBookings
};
