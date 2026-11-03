# Apex Health Clinic Booking API & Patient Terminal

A full-stack, enterprise-grade clinic appointment scheduling platform built for the **Koya Academy Cohort 4 Assessment (Task 1)**.

The system combines an interactive Single Page Patient Terminal with a REST API strictly adhering to the [OpenAPI Specification](openapi.json) across all 5 evaluation levels.

---

## Folder Architecture

```text
clinic-booking-api/
├── client/                     # Frontend Single Page Patient Terminal
│   └── index.html              # Combined Stitch UI (Browse Slots + My Appointments)
├── server/                     # Backend API & Database
│   ├── server.js               # Express API implementing all OpenAPI endpoints
│   ├── db.js                   # Dual-mode DB adapter (PostgreSQL + atomic local fallback)
│   └── test/
│       └── suite.js            # Automated test suite (Levels 1–5, 20 test cases)
├── api/                        # Serverless entry point (for Vercel deployment)
│   └── index.js
├── vercel.json                 # Vercel deployment routing configuration
├── openapi.json                # Official Koya Academy Assessment contract
├── package.json                # Root scripts and dependencies
└── README.md
```

---

## Evaluation Levels Implemented

| Level | Feature Set | Architectural Implementation |
| :--- | :--- | :--- |
| **Level 1** | **Core Booking & Slot CRUD** | `POST /reset` to flush/replace slots; `GET /slots` with provider filters and earliest-start sorting; `POST /bookings` creating confirmed appointments; `GET /bookings/:id` lookup. |
| **Level 2** | **Auth & Strict Validation** | Enforces `X-API-Key` on all protected routes (returns 401). Validates required fields, email format, and checks that slots exist and have not started (returns 400 or 404). Automatically trims names and stores emails in lowercase. |
| **Level 3** | **Concurrency & Cancellation** | **Race-condition proof:** Database row-locking (`FOR UPDATE`) and unique constraint index prevent double-booking when simultaneous requests arrive. `DELETE /bookings/:id` sets status to `cancelled` and immediately frees the slot. |
| **Level 4** | **Idempotency & Pagination** | Supports optional `Idempotency-Key` header. Identical keys with matching payloads return the existing booking; key re-use with differing bodies returns 422. `GET /bookings` implements cursor-based pagination with `limit` (1–50) and `next_cursor`. |
| **Level 5** | **Anti-Spam Rate Limiting** | Restricts booking attempts to **at most 5 per email per minute** (including failed attempts). The 6th attempt returns `429 Too Many Requests` with a dynamic `Retry-After` header in whole seconds. |

---

## Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Automated Test Suite (All 5 Levels)
```bash
npm test
```
*Executes all 20 test cases covering CRUD, authentication, concurrency locks, idempotency, pagination, and rate-limiting.*

### 3. Start the Server Locally
```bash
npm start
```
Open **`http://localhost:3000`** in your browser.

---

## Deployment to Vercel (100% Free)

Vercel is blazing fast, has zero cold start timeouts, and gives you an instant HTTPS URL.

### Step 1: Create a Free PostgreSQL Database on Neon
1. Go to [neon.tech](https://neon.tech) and create a free project (no credit card required).
2. Copy your connection string:
   ```text
   postgresql://<user>:<password>@<endpoint>.neon.tech/neondb?sslmode=require
   ```

### Step 2: Push Your Code to GitHub
```bash
cd clinic-booking-api
git init
git add .
git commit -m "Complete clinic booking API with client/server architecture"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/koya-clinic-booking.git
git push -u origin main
```

### Step 3: Deploy on Vercel
1. Log in to [vercel.com](https://vercel.com) $\rightarrow$ Click **"Add New..."** $\rightarrow$ **"Project"**.
2. Import your **`koya-clinic-booking`** GitHub repository.
3. In the project settings under **Environment Variables**, add:
   - **`API_KEY`** = `koya-clinic-key-2026` *(or your preferred secret)*
   - **`DATABASE_URL`** = *(Paste your Neon PostgreSQL connection string)*
4. Click **Deploy**.

Vercel will output a live HTTPS URL (e.g. `https://koya-clinic-booking.vercel.app`).
Both the **interactive web page** (at `/`) and the **API endpoints** (`/slots`, `/bookings`, `/reset`) are live on that single URL.
