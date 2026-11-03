// test/suite.js - Automated Test Suite for Levels 1 to 5
const http = require('http');
const assert = require('assert');
const { app } = require('../server');

const API_KEY = process.env.API_KEY || 'koya-clinic-key-2026';
let server;
let BASE_URL;

// Helper to make HTTP requests
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...headers
    };

    const req = http.request(
      url,
      {
        method,
        headers: defaultHeaders
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json || data
          });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=============================================');
  console.log('STARTING CLINIC BOOKING API TEST SUITE (1-5)');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${e.message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // LEVEL 1 TESTS
  // -------------------------------------------------------------
  console.log('--- LEVEL 1: Core Slot & Booking CRUD ---');

  const futureSlot1 = {
    id: 's_lvl1_01',
    provider: 'Dr Ade',
    start: new Date(Date.now() + 86400000).toISOString(),
    end: new Date(Date.now() + 86400000 + 1800000).toISOString()
  };

  const futureSlot2 = {
    id: 's_lvl1_02',
    provider: 'Dr Okon',
    start: new Date(Date.now() + 172800000).toISOString(),
    end: new Date(Date.now() + 172800000 + 1800000).toISOString()
  };

  const pastSlot = {
    id: 's_lvl1_past',
    provider: 'Dr Bello',
    start: new Date(Date.now() - 86400000).toISOString(),
    end: new Date(Date.now() - 86400000 + 1800000).toISOString()
  };

  await test('POST /reset replaces all slots and clears bookings', async () => {
    const res = await request('POST', '/reset', {
      slots: [futureSlot2, futureSlot1, pastSlot]
    });
    assert.strictEqual(res.status, 200);
  });

  await test('GET /slots returns slots sorted earliest start first with available: true', async () => {
    const res = await request('GET', '/slots');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.slots));
    assert.strictEqual(res.body.slots.length, 3);
    assert.strictEqual(res.body.slots[0].id, 's_lvl1_past'); // Earliest first
    assert.strictEqual(res.body.slots[0].available, true);
  });

  await test('GET /slots?provider=Dr Ade filters correctly', async () => {
    const res = await request('GET', '/slots?provider=Dr Ade');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.slots.length, 1);
    assert.strictEqual(res.body.slots[0].provider, 'Dr Ade');
  });

  let createdBookingId = null;
  await test('POST /bookings returns 201 with confirmed status', async () => {
    const res = await request('POST', '/bookings', {
      slot_id: futureSlot1.id,
      name: 'Ada Obi',
      email: 'ada@example.com'
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.strictEqual(res.body.slot_id, futureSlot1.id);
    assert.strictEqual(res.body.status, 'confirmed');
    createdBookingId = res.body.id;
  });

  await test('GET /bookings/:id returns the created booking', async () => {
    const res = await request('GET', `/bookings/${createdBookingId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, createdBookingId);
    assert.strictEqual(res.body.email, 'ada@example.com');
  });

  // -------------------------------------------------------------
  // LEVEL 2 TESTS: Authentication & Validation
  // -------------------------------------------------------------
  console.log('\n--- LEVEL 2: Auth & Request Validation ---');

  await test('Missing X-API-Key returns 401', async () => {
    const res = await request('GET', '/slots', null, { 'X-API-Key': '' });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error);
  });

  await test('Wrong X-API-Key returns 401', async () => {
    const res = await request('GET', '/slots', null, { 'X-API-Key': 'wrong-key-xyz' });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error);
  });

  await test('POST /bookings with missing or empty fields returns 400', async () => {
    const res = await request('POST', '/bookings', {
      slot_id: '',
      name: '   ',
      email: ''
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  await test('POST /bookings with invalid email returns 400', async () => {
    const res = await request('POST', '/bookings', {
      slot_id: futureSlot2.id,
      name: 'Ada Obi',
      email: 'not-an-email'
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  await test('POST /bookings with non-existent slot returns 404', async () => {
    const res = await request('POST', '/bookings', {
      slot_id: 'non-existent-slot-id-999',
      name: 'Ada Obi',
      email: 'ada@example.com'
    });
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.error);
  });

  await test('POST /bookings for slot in the past returns 400', async () => {
    const res = await request('POST', '/bookings', {
      slot_id: pastSlot.id,
      name: 'Ada Obi',
      email: 'ada@example.com'
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  await test('POST /bookings trims name and stores email in lower case', async () => {
    const res = await request('POST', '/bookings', {
      slot_id: futureSlot2.id,
      name: '  Koya Candidate  ',
      email: '  KOYA.TEST@EXAMPLE.COM  '
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.name, 'Koya Candidate');
    assert.strictEqual(res.body.email, 'koya.test@example.com');
  });

  // -------------------------------------------------------------
  // LEVEL 3 TESTS: Concurrency & Cancellation
  // -------------------------------------------------------------
  console.log('\n--- LEVEL 3: Concurrency Race Conditions & Cancellation ---');

  const raceSlot = {
    id: 's_race_test',
    provider: 'Dr Concurrency',
    start: new Date(Date.now() + 300000000).toISOString(),
    end: new Date(Date.now() + 300000000 + 1800000).toISOString()
  };

  await request('POST', '/reset', { slots: [raceSlot] });

  await test('High-concurrency test: 10 simultaneous bookings for 1 slot -> exactly 1 succeeds, 9 return 409', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      request('POST', '/bookings', {
        slot_id: raceSlot.id,
        name: `Racer ${i}`,
        email: `racer_${i}@race-example.com`
      })
    );

    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r.status === 201).length;
    const conflictCount = results.filter((r) => r.status === 409).length;

    assert.strictEqual(successCount, 1, `Expected exactly 1 success, got ${successCount}`);
    assert.strictEqual(conflictCount, 9, `Expected exactly 9 conflicts (409), got ${conflictCount}`);
  });

  await test('DELETE /bookings/:id cancels booking, returns 200, and frees the slot', async () => {
    const slotsRes = await request('GET', '/slots');
    assert.strictEqual(slotsRes.body.slots[0].available, false);

    // Get the winning booking
    const bookingsRes = await request('GET', '/bookings?email=racer_0@race-example.com');
    let winningBookingId = bookingsRes.body.bookings[0]?.id;
    if (!winningBookingId) {
      for (let i = 1; i < 10; i++) {
        const b = await request('GET', `/bookings?email=racer_${i}@race-example.com`);
        if (b.body.bookings.length > 0) {
          winningBookingId = b.body.bookings[0].id;
          break;
        }
      }
    }

    assert.ok(winningBookingId, 'Winning booking ID should be found');

    const cancelRes = await request('DELETE', `/bookings/${winningBookingId}`);
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.status, 'cancelled');

    // Verify slot is now available again
    const refreshedSlots = await request('GET', '/slots');
    assert.strictEqual(refreshedSlots.body.slots[0].available, true);
  });

  await test('Cancelling an already cancelled booking returns 409', async () => {
    const listRes = await request('GET', '/bookings?email=racer_0@race-example.com');
    const cancelledId = listRes.body.bookings[0]?.id;
    if (cancelledId) {
      const res = await request('DELETE', `/bookings/${cancelledId}`);
      assert.strictEqual(res.status, 409);
      assert.ok(res.body.error);
    }
  });

  // -------------------------------------------------------------
  // LEVEL 4 TESTS: Idempotency & Cursor Pagination
  // -------------------------------------------------------------
  console.log('\n--- LEVEL 4: Idempotency Keys & Cursor Pagination ---');

  const idempSlot = {
    id: 's_idemp_slot',
    provider: 'Dr Idempotent',
    start: new Date(Date.now() + 400000000).toISOString(),
    end: new Date(Date.now() + 400000000 + 1800000).toISOString()
  };
  await request('POST', '/reset', { slots: [idempSlot] });

  let idempBooking = null;
  await test('Idempotency-Key with same body returns identical response and creates no duplicate', async () => {
    const key = 'idem_key_12345';
    const body = { slot_id: idempSlot.id, name: 'Alice', email: 'alice@example.com' };

    const first = await request('POST', '/bookings', body, { 'Idempotency-Key': key });
    assert.strictEqual(first.status, 201);
    idempBooking = first.body;

    const second = await request('POST', '/bookings', body, { 'Idempotency-Key': key });
    assert.strictEqual(second.status, 201);
    assert.strictEqual(second.body.id, idempBooking.id);
  });

  await test('Reusing Idempotency-Key with different body returns 422', async () => {
    const key = 'idem_key_12345';
    const diffBody = { slot_id: idempSlot.id, name: 'Bob Different', email: 'bob@example.com' };

    const res = await request('POST', '/bookings', diffBody, { 'Idempotency-Key': key });
    assert.strictEqual(res.status, 422);
    assert.ok(res.body.error);
  });

  await test('Cursor pagination on GET /bookings returns correct pages and next_cursor: null on last page', async () => {
    // Generate 4 slots and 4 bookings (under the 5/minute rate limit)
    const pageSlots = Array.from({ length: 4 }, (_, i) => ({
      id: `s_page_${i}`,
      provider: 'Dr Pager',
      start: new Date(Date.now() + 500000000 + i * 3600000).toISOString(),
      end: new Date(Date.now() + 500000000 + i * 3600000 + 1800000).toISOString()
    }));

    await request('POST', '/reset', { slots: pageSlots });

    for (let i = 0; i < 4; i++) {
      const r = await request('POST', '/bookings', {
        slot_id: `s_page_${i}`,
        name: 'Page Patient',
        email: 'patient_page@example.com'
      });
      assert.strictEqual(r.status, 201);
    }

    // Page 1: limit 2
    const page1 = await request('GET', '/bookings?email=patient_page@example.com&limit=2');
    assert.strictEqual(page1.status, 200);
    assert.strictEqual(page1.body.bookings.length, 2);
    assert.ok(page1.body.next_cursor, 'Page 1 should have next_cursor');

    // Page 2: limit 2 with cursor (final page)
    const page2 = await request('GET', `/bookings?email=patient_page@example.com&limit=2&cursor=${encodeURIComponent(page1.body.next_cursor)}`);
    assert.strictEqual(page2.status, 200);
    assert.strictEqual(page2.body.bookings.length, 2);
    assert.strictEqual(page2.body.next_cursor, null, 'Last page must have next_cursor: null');
  });

  await test('Invalid limit on GET /bookings returns 400', async () => {
    const res = await request('GET', '/bookings?email=test@example.com&limit=999');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  // -------------------------------------------------------------
  // LEVEL 5 TESTS: Rate Limiting
  // -------------------------------------------------------------
  console.log('\n--- LEVEL 5: Anti-Spam Rate Limiting ---');

  await test('6th attempt within a minute for the same email returns 429 with Retry-After header', async () => {
    const spamEmail = `spammer_${Date.now()}@example.com`;

    // 5 attempts (even on invalid slots or failed validation)
    for (let i = 0; i < 5; i++) {
      const res = await request('POST', '/bookings', {
        slot_id: 'non-existent',
        name: 'Spammer',
        email: spamEmail
      });
      assert.strictEqual(res.status, 404); // Failed attempt counts towards rate limit
    }

    // 6th attempt should be blocked by rate limiter
    const sixth = await request('POST', '/bookings', {
      slot_id: 'non-existent',
      name: 'Spammer',
      email: spamEmail
    });

    assert.strictEqual(sixth.status, 429, `Expected 429, got ${sixth.status}`);
    assert.ok(sixth.headers['retry-after'], 'Retry-After header must be present');
    assert.ok(!isNaN(parseInt(sixth.headers['retry-after'], 10)), 'Retry-After must be a number');
    assert.ok(sixth.body.error);
  });

  // Teardown
  console.log('\n=============================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================\n');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

// Start test server on random port
server = app.listen(0, () => {
  const port = server.address().port;
  BASE_URL = `http://localhost:${port}`;
  runTests().catch((err) => {
    console.error('Fatal test error:', err);
    server.close();
    process.exit(1);
  });
});
