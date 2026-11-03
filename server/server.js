// server.js - Apex Health Clinic Booking API & Patient Terminal
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'koya-clinic-key-2026';

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend UI from ../client
app.use(express.static(path.join(__dirname, '..', 'client')));

// Email Validation Regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Level 2 Authentication Middleware: Check X-API-Key on protected endpoints
function authenticateApiKey(req, res, next) {
  // Allow public static frontend assets and health check
  if (req.path === '/' || req.path === '/health' || req.path.startsWith('/public')) {
    return next();
  }

  const clientKey = req.headers['x-api-key'];
  if (!clientKey || clientKey !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized: missing or invalid API key' });
  }
  next();
}

app.use(authenticateApiKey);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// -------------------------------------------------------------
// Level 1: POST /reset - Replace all slots and clear bookings
// -------------------------------------------------------------
app.post('/reset', async (req, res) => {
  try {
    const { slots } = req.body;
    if (!Array.isArray(slots)) {
      return res.status(400).json({ error: 'slots array is required' });
    }

    await db.resetSlots(slots);
    res.status(200).json({ message: 'Done' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: 'internal server error during reset' });
  }
});

// -------------------------------------------------------------
// Level 1: GET /slots - List all slots earliest start first
// -------------------------------------------------------------
app.get('/slots', async (req, res) => {
  try {
    const provider = req.query.provider ? String(req.query.provider).trim() : null;
    const slots = await db.getSlots(provider);
    res.status(200).json({ slots });
  } catch (err) {
    console.error('Get slots error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// -------------------------------------------------------------
// Levels 1 - 5: POST /bookings - Book a slot
// -------------------------------------------------------------
app.post('/bookings', async (req, res) => {
  try {
    let { slot_id, name, email } = req.body || {};

    // Level 2: Trim spaces and lowercase email
    if (typeof name === 'string') name = name.trim();
    if (typeof email === 'string') email = email.trim().toLowerCase();
    if (typeof slot_id === 'string') slot_id = slot_id.trim();

    // Level 5: Rate Limiting Check (At most 5 attempts per email per minute)
    // Runs before validation if email is present, as failed attempts also count
    if (email) {
      const rateCheck = await db.recordAttemptAndCheckRateLimit(email);
      if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter));
        return res.status(429).json({ error: 'too many attempts for this email, please retry later' });
      }
    }

    // Level 2 Validation: Missing or empty fields
    if (!slot_id || !name || !email) {
      return res.status(400).json({ error: 'slot_id, name, and email are required and cannot be empty' });
    }

    // Level 2 Validation: Valid email format
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'invalid email address format' });
    }

    // Level 4: Idempotency Key Handling
    const idempotencyKey = req.headers['idempotency-key'];
    let requestHash = null;

    if (idempotencyKey) {
      requestHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ slot_id, name, email }))
        .digest('hex');

      const existingRecord = await db.getIdempotencyRecord(idempotencyKey);
      if (existingRecord) {
        if (existingRecord.requestHash === requestHash) {
          // Same key with same body: return cached response
          return res.status(existingRecord.statusCode).json(existingRecord.responseBody);
        } else {
          // Same key with different body: 422
          return res.status(422).json({ error: 'idempotency key reused with different body' });
        }
      }
    }

    // Level 2: Check if slot exists
    const slot = await db.getSlotById(slot_id);
    if (!slot) {
      return res.status(404).json({ error: 'slot not found' });
    }

    // Level 2: Check if slot has already started
    const slotStartTime = new Date(slot.start).getTime();
    if (slotStartTime <= Date.now()) {
      return res.status(400).json({ error: 'slot has already started' });
    }

    // Level 3 Concurrency: Attempt atomic booking
    const bookingId = `bk_${crypto.randomBytes(6).toString('hex')}`;
    const result = await db.createBooking({
      id: bookingId,
      slot_id,
      name,
      email
    });

    if (result.conflict) {
      return res.status(409).json({ error: 'slot already booked' });
    }

    // Level 4: Store idempotency record on successful creation
    if (idempotencyKey && requestHash) {
      await db.saveIdempotencyRecord(idempotencyKey, requestHash, 201, result.booking);
    }

    res.status(201).json(result.booking);
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: 'internal server error during booking' });
  }
});

// -------------------------------------------------------------
// Level 4: GET /bookings - List a person's bookings (cursor pagination)
// -------------------------------------------------------------
app.get('/bookings', async (req, res) => {
  try {
    const { email, limit, cursor } = req.query;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email query parameter is required' });
    }

    let parsedLimit = 10;
    if (limit !== undefined) {
      const n = Number(limit);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        return res.status(400).json({ error: 'invalid limit: must be an integer between 1 and 50' });
      }
      parsedLimit = n;
    }

    const result = await db.getPersonBookings(email, parsedLimit, cursor || null);
    res.status(200).json(result);
  } catch (err) {
    console.error('List bookings error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// -------------------------------------------------------------
// Level 1: GET /bookings/:id - Look up a booking
// -------------------------------------------------------------
app.get('/bookings/:id', async (req, res) => {
  try {
    const booking = await db.getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: 'booking not found' });
    }
    res.status(200).json(booking);
  } catch (err) {
    console.error('Get booking error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// -------------------------------------------------------------
// Level 3: DELETE /bookings/:id - Cancel a booking
// -------------------------------------------------------------
app.delete('/bookings/:id', async (req, res) => {
  try {
    const result = await db.cancelBooking(req.params.id);

    if (result.notFound) {
      return res.status(404).json({ error: 'booking not found' });
    }
    if (result.alreadyCancelled) {
      return res.status(409).json({ error: 'booking already cancelled' });
    }

    res.status(200).json(result.booking);
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Fallback 404 for unknown API routes
app.use((req, res) => {
  res.status(404).json({ error: 'endpoint not found' });
});

// Initialize database and start server
async function start() {
  try {
    await db.initDb();
  } catch (err) {
    console.error('Initial DB connection notice (will reconnect when network is ready):', err.message);
  }
  app.listen(PORT, () => {
    console.log(`Apex Health Clinic Booking API running on port ${PORT}`);
    console.log(`API Key set to: ${API_KEY}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
