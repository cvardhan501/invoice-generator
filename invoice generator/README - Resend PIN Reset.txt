INVOICE GENERATOR — EMAIL PIN RESET
===================================

LOCAL SETUP
1. Install Node.js 18 or later.
2. Copy .env.example to .env. Do not commit or share .env.
3. Set RESEND_API_KEY to your private Resend API key.
4. Set RESEND_FROM_EMAIL to a sender address/domain approved in your Resend account.
   The backend does not assume that Resend's test sender is approved for your account.
5. Keep ADMIN_EMAIL=nakshashreyas@gmail.com.
6. For local development, set APP_BASE_URL=http://localhost:3000 and PORT=3000.
7. Start the server from this folder with: npm start
8. Open your browser to http://localhost:3000 to use the Invoice Generator.
   (VS Code Live Server on http://localhost:5500 or http://127.0.0.1:5500 remains fully supported via CORS).

The backend serves both the application pages and the API endpoints from port 3000,
ensuring a unified origin for localStorage PIN and invoice data. PIN reset needs
both a running backend and an internet connection to reach Resend.

SECURITY AND PIN STORAGE
- Reset-request emails are always addressed to the configured administrator. A recipient
  sent by a browser is never used.
- Reset tokens are cryptographically random, stored only as SHA-256 hashes, expire after
  15 minutes, and are invalidated when successfully used.
- The reset link is sent only after Resend accepts the email request. The PIN is never
  emailed or returned by the API.
- The existing application stores its PIN hash and invoice data in browser localStorage.
  Consequently, the email link must be opened in the same browser profile and origin
  (http://localhost:3000 locally) as the app data. The backend validates and consumes the
  reset token; the reset page then updates the local PIN hash. This is a local convenience
  lock, not server-side account authentication or encryption.
- Invoice records, draft data, and printing do not depend on the email service. The app
  references no external CDN assets and uses system-font fallbacks, but access through
  Live Server still requires that local server to be running.
- .env and .pin-reset-tokens.json are excluded by .gitignore. Never put Resend credentials
  in HTML, frontend JavaScript, URLs, logs, or API responses.

DEPLOYMENT
The frontend currently calls http://localhost:3000 directly for the requested local setup.
For deployment to other hosts, update both frontend API URLs to the backend's HTTPS origin,
set APP_BASE_URL to the frontend's exact origin (not the backend URL), and use a sender
verified with Resend. A four-digit local PIN should not be treated as a strong security
boundary.
