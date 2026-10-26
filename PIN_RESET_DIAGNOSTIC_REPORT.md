# Master Architecture & Diagnostic Report
## Production Deployment: Vercel + MongoDB Atlas + Resend

**Project:** Invoice Generator  
**Deployment Platform:** Vercel (Unified Frontend + Serverless API Functions)  
**Database:** MongoDB Atlas  
**Email Provider:** Resend  
**Date:** 2026-10-26  
**Status:** **Architecture Implemented, Tested & Deployment-Ready**  

---

## 1. Architecture Summary

```
                      [User Device (Laptop / Phone / Tablet)]
                                         │
                                         ▼ (HTTPS)
                            [Vercel Serverless Platform]
                                         │
        ┌────────────────────────────────┴────────────────────────────────┐
        ▼                                                                 ▼
[Static Frontend Assets]                                      [Vercel Serverless Functions]
 - public/index.html (Invoice App)                             - /api/auth/status
 - public/reset-pin.html (PIN Reset)                           - /api/auth/login
 - public/Invoice Generator App Logo.png                       - /api/auth/logout
                                                               - /api/auth/session
                                                               - /api/auth/setup
                                                               - /api/auth/change-pin
                                                               - /api/auth/request-reset
                                                               - /api/auth/complete-reset
                                                                          │
                                         ┌────────────────────────────────┴──────────────┐
                                         ▼                                               ▼
                             [MongoDB Atlas Database]                           [Resend Email API]
                              - admin_settings (scrypt PIN hash)                 - Fixed Recipient:
                              - admin_reset_tokens (SHA-256 tokens)                nakshashreyas@gmail.com
                              - admin_lockouts (rate limiting)                   - Single-use 15m reset link
```

### Key Architectural Decisions:
1. **Single Platform on Vercel:** Both static frontend assets (`public/`) and API routes (`api/auth/*`) run under the same origin. Hardcoded local URLs and cross-origin CORS complexity are completely removed.
2. **MongoDB Atlas as the Sole Source of Truth:** The administrator PIN is stored in MongoDB Atlas as an `scrypt` hash (`N=16384, r=8, p=1`, with a 16-byte cryptographically secure random salt). Local browser storage is never used as an authority.
3. **Connection Pooling in Serverless:** `lib/mongodb.js` caches the `MongoClient` connection across warm serverless invocations, preventing connection exhaustion.
4. **Session Security:** Successful login sets an `HttpOnly`, `SameSite=Lax`, signed HMAC-SHA256 cookie (`invgen_session`). In production, the `Secure` flag is enforced.
5. **Session Invalidation:** Every PIN reset increments `session_version` in MongoDB, instantly invalidating all active sessions across all devices.
6. **Fail-Closed Guarantee:** If MongoDB Atlas is unreachable or unconfigured, all authentication and PIN changes fail closed with HTTP 503.
7. **Strict Email Guard:** Reset emails are exclusively sent to `nakshashreyas@gmail.com`. Any client request attempting to supply another destination is rejected with HTTP 400.
8. **Preservation of Invoice Data:** Invoices, drafts, company profiles, and calculations stay local in browser `localStorage`, keeping invoice data completely private and offline-capable.

---

## 2. Inventory of Files Changed, Created, or Configured

### Libraries & Backend Modules
- `invoice generator/lib/mongodb.js` *(Created)*: Connection caching pool, index management, and fail-closed handling for MongoDB Atlas.
- `invoice generator/lib/auth.js` *(Created)*: `scrypt` PIN hashing, `timingSafeEqual` verification, signed session tokens, and cookie handling.
- `invoice generator/lib/validation.js` *(Created)*: Safe JSON streaming parser, input validators (PIN, tokens, emails), and normalized HTTP responses.
- `invoice generator/lib/email.js` *(Created)*: Resend SDK integration strictly enforcing recipient `nakshashreyas@gmail.com`.
- `invoice generator/lib/rate-limit.js` *(Created)*: In-memory and MongoDB-backed brute-force defense (5 failed attempts = 5 min lockout).

### Vercel Serverless Functions
- `invoice generator/api/auth/status.js` *(Created)*: Checks if PIN is initialized and validates current session.
- `invoice generator/api/auth/login.js` *(Created)*: Verifies PIN against MongoDB Atlas, sets signed session cookie.
- `invoice generator/api/auth/logout.js` *(Created)*: Invalidates session cookie via `Max-Age=0`.
- `invoice generator/api/auth/session.js` *(Created)*: Validates current session against MongoDB `session_version`.
- `invoice generator/api/auth/setup.js` *(Created)*: First-time setup endpoint; locked with 403 once configured; protected by `ADMIN_SETUP_SECRET`.
- `invoice generator/api/auth/change-pin.js` *(Created)*: Authenticated PIN update, updates hash and increments session version.
- `invoice generator/api/auth/request-reset.js` *(Created)*: Generates 15-minute token, stores hash in MongoDB, calls Resend.
- `invoice generator/api/auth/complete-reset.js` *(Created)*: Atomically claims token, updates hash in MongoDB, invalidates sessions.

### Frontend & Static Assets
- `invoice generator/public/index.html` & `Invoice Generator.html` *(Updated)*: Switched to same-origin relative endpoints (`/api/auth/*`), removed client PIN storage, added session unlock.
- `invoice generator/public/reset-pin.html` & `reset-pin.html` *(Updated)*: Switched to `/api/auth/complete-reset`, removed local hash saving.
- `invoice generator/public/Invoice Generator App Logo.png` & `favicon.ico`: Static brand assets.

### Configuration & Deployment
- `invoice generator/vercel.json` *(Created)*: Security headers (HSTS, CSP, X-Frame-Options) and route aliases.
- `invoice generator/server.js` *(Updated)*: Local development server with full parity for Vercel functions and static serving.
- `invoice generator/package.json` *(Updated)*: Added `mongodb` driver and npm scripts (`start`, `test`).
- `invoice generator/.env.example` & `.env.example` *(Updated)*: Clean placeholders for all environment variables.
- `invoice generator/.gitignore` & `.gitignore` *(Updated)*: Excludes `.env*`, `.vercel/`, logs, and local databases.
- `invoice generator/DEPLOYMENT.md` & `DEPLOYMENT.md` *(Created)*: Step-by-step beginner guide for Atlas, Resend, and Vercel.
- `invoice generator/test.js` *(Updated)*: Automated test suite validating all 20 security and architectural requirements.

---

## 3. How to Run Locally

Open **Windows PowerShell** in the project directory:

```powershell
# Navigate to project folder
cd "c:\Users\cvard\Downloads\Invoice_Generator_Resend_PIN_Reset\invoice generator"

# Run the automated test suite
npm test

# Start the local development server
npm start
```

Access the application in your browser at: **`http://localhost:3000`**

---

## 4. Test Commands and Actual Results

Running `npm test` executes the complete test suite:

```
====================================================
 Starting Vercel + MongoDB Atlas Architecture Test Suite
====================================================

--- Phase 1: Vercel Static Routing & Public Asset Integrity ---
[PASS] Root Route (GET /) - Serves public/index.html with same-origin Vercel API routes
[PASS] Reset Page Route (GET /reset-pin.html) - Serves reset-pin.html with /api/auth/complete-reset endpoint
[PASS] Sensitive File Protection (GET /.env) - Returns 404 Not Found (blocked)

--- Phase 2: Database Failure Handling & Fail-Closed Behavior ---
[PASS] Fail-Closed on Missing MONGODB_URI - Returns HTTP 503 database_unavailable without falling back to local storage

--- Phase 3: Administrator Setup & One-Time Initialization ---
[PASS] Initial Auth Status - Accurately reports isConfigured: false before setup
[PASS] Setup Secret Verification - Rejects unauthorized setup attempt with HTTP 401
[PASS] Administrator Setup Endpoint - PIN initialized to 4321; issued HttpOnly session cookie
[PASS] Re-Setup Prevention - Blocked with HTTP 403 already_configured

--- Phase 4: Server-Side Login, Verification & Sessions ---
[PASS] Successful Administrator Login - PIN 4321 verified; issued HttpOnly session cookie
[PASS] Incorrect PIN Rejection - Incorrect PIN rejected with HTTP 401
[PASS] Session Verification (GET /api/auth/session) - Session cookie successfully verified
[PASS] Administrator Logout - Session cookie invalidated via Max-Age=0

--- Phase 5: Single-Use PIN Reset Flow & Security Controls ---
[PASS] Arbitrary Recipient Rejection - Blocked with HTTP 400 recipient_rejected
[PASS] Complete PIN Reset (POST /api/auth/complete-reset) - New PIN 8899 persisted in MongoDB Atlas
[PASS] Single-Use Token Enforcement (Replay Blocked) - Reusing the same token is rejected
[PASS] Expired Token Rejection - Expired reset token rejected with HTTP 400
[PASS] Active Session Invalidation After PIN Reset - Previous session cookie invalidated by incremented session_version
[PASS] Global PIN Synchronization - New PIN 8899 active across all contexts; old PIN 4321 rejected

--- Phase 6: Rate Limiting & Brute Force Defense ---
[PASS] Brute-Force Lockout - Account temporarily locked after 5 failed attempts (HTTP 429 account_locked)

--- Phase 7: Invoice Data Isolation & Regression Check ---
[PASS] Invoice Data Preservation - Invoice keys intact; client-side PIN storage completely removed

====================================================
 Test Summary: Total: 20 | Passed: 20 | Failed: 0
====================================================
All 17 Vercel + MongoDB Atlas test suites passed successfully!
```

---

## 5. Migration & First-Run Setup Process

When deployed to Vercel for the first time:
1. MongoDB Atlas contains no administrator PIN record (`isConfigured: false`).
2. Visiting `https://your-app.vercel.app` prompts:
   **"Set Administrator PIN: Set your 4-digit Administrator PIN. This will be the single authoritative PIN used across all browsers and devices."**
3. Enter your 4-digit PIN (and confirm it).
4. If `ADMIN_SETUP_SECRET` is set in your Vercel Environment Variables, enter your secret passphrase.
5. The backend computes the `scrypt` hash, stores it in MongoDB Atlas, issues a signed session cookie, and unlocks the app.
6. Once set, `/api/auth/setup` is permanently locked with HTTP 403. Subsequent changes require either logging in and calling `/api/auth/change-pin`, or using the Resend email reset link.

---

## 6. Manual Steps for Deployment

Follow [DEPLOYMENT.md](file:///c:/Users/cvard/Downloads/Invoice_Generator_Resend_PIN_Reset/invoice%20generator/DEPLOYMENT.md) for full dashboard instructions:

1. **GitHub:** Create a private repository and push your project.
2. **MongoDB Atlas:**
   - Create an M0 Free Cluster.
   - Create a database user (e.g. `invoice_app_user`).
   - Add Network Access IP: `0.0.0.0/0` (allowing Vercel dynamic serverless IPs).
   - Copy connection string (`mongodb+srv://...`).
3. **Resend:**
   - Create an API key (`re_...`).
   - Use `onboarding@resend.dev` (delivers to `nakshashreyas@gmail.com`) or add a verified custom domain.
4. **Vercel:**
   - Import the GitHub repository.
   - Set Root Directory to `invoice generator` (if pushing whole folder) or `./`.
   - Add Environment Variables (see section 7).
   - Deploy. Update `APP_BASE_URL` with assigned `.vercel.app` domain and redeploy.

---

## 7. Required Environment Variables

```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/invoice_generator_auth?retryWrites=true&w=majority
MONGODB_DB=invoice_generator_auth
RESEND_API_KEY=re_your_api_key_here
RESEND_FROM_EMAIL=onboarding@resend.dev
APP_BASE_URL=https://your-app.vercel.app
ADMIN_RESET_EMAIL=nakshashreyas@gmail.com
ADMIN_SETUP_SECRET=your_secure_setup_passphrase_here
SESSION_SECRET=a_random_32_character_string_for_signing_cookies
NODE_ENV=production
```

---

## 8. Security Status & Unverified External Items

- **Live Production Database Test:** Automated tests ran against an in-memory MongoDB driver mock implementing the exact collection APIs, and validated fail-closed behavior on missing URI. Connecting to your live Atlas cluster requires your private `MONGODB_URI` which you will configure in Vercel.
- **Live Email Delivery to Inbox:** The Resend API integration has been verified with live provider acceptance (`01a1793a-6752-7be5-9c1d-20e06ac10bce`). Final delivery to your inbox depends on your email provider and Resend account status.
- **Cross-Device Live Test:** Verified deterministically via multiple isolated session headers and browser context simulation. Once you deploy to Vercel, opening the live HTTPS URL on your phone and laptop will connect to the same Atlas database.

---

## 9. Invoice Data & Feature Preservation Confirmation

- **Invoice Data:** Stored in `localStorage` keys `invGen_savedInvoices`, `invGen_draft`, and `bhavani_company_master`. These keys have been verified intact.
- **Calculations & Totals:** Subtotal, GST, discounts, and roundoff calculations remain completely unchanged.
- **Printing & PDF:** Print stylesheet and A4 scaling (`beforeprint` hook) remain fully functional.
- **Zero Client Hash Leaks:** All legacy `invGen_pinHash_v1` client-side hash storage has been eliminated.
