# Deployment Guide: Vercel + MongoDB Atlas + Resend

This guide provides end-to-end instructions for deploying the **Invoice Generator** to **Vercel** with **MongoDB Atlas** as the authoritative PIN database and **Resend** for administrator PIN reset emails.

---

## 1. Architecture Overview

```
[Browser on any Laptop / Phone / Tablet]
                 │
                 ▼ (HTTPS)
   [Vercel Global Edge Network]
  ├── Static Assets (public/index.html, reset-pin.html, logo)
  └── Serverless Functions (/api/auth/*)
         │                     │
         ▼                     ▼
[MongoDB Atlas Cluster]   [Resend Email API]
 (Authoritative PIN)      (Sends strictly to nakshashreyas@gmail.com)
```

- **Single Platform:** Vercel hosts both the frontend and the Node.js API functions on a single unified HTTPS domain.
- **Global Administrator PIN:** The PIN is stored exclusively in MongoDB Atlas as an `scrypt` cryptographic hash (`N=16384, r=8, p=1`). No PIN hashes exist in browser storage.
- **Fail-Closed Security:** If MongoDB Atlas is unreachable, authentication immediately fails closed with HTTP 503 rather than falling back to local storage.
- **Strict Recipient Restriction:** Reset emails are dispatched exclusively to `nakshashreyas@gmail.com`. Any attempt by a caller to provide another address is rejected.
- **Local Invoice Preservation:** Invoice drafts and saved invoices remain in the user's browser `localStorage`, ensuring complete offline calculation and privacy.

---

## 2. Prerequisites & Environment Variables

You will need accounts on:
1. **GitHub** (to host your repository)
2. **MongoDB Atlas** (free M0 cluster is sufficient)
3. **Resend** (for sending emails)
4. **Vercel** (for deployment)

### Required Production Environment Variables

| Variable | Description | Example / Allowed Value |
| :--- | :--- | :--- |
| `MONGODB_URI` | MongoDB Atlas connection string | `mongodb+srv://inv_user:<password>@cluster0.abcde.mongodb.net/invoice_generator_auth?retryWrites=true&w=majority` |
| `MONGODB_DB` | Dedicated database name | `invoice_generator_auth` |
| `RESEND_API_KEY` | Private Resend API key | `re_123456789...` |
| `RESEND_FROM_EMAIL` | Approved sender address | `onboarding@resend.dev` (testing) or `invoices@yourdomain.com` |
| `APP_BASE_URL` | Your live Vercel production HTTPS domain | `https://your-invoice-app.vercel.app` |
| `ADMIN_RESET_EMAIL` | Fixed recipient for reset emails | `nakshashreyas@gmail.com` |
| `ADMIN_SETUP_SECRET` | Secret passphrase to authorize initial setup | A secure random string (e.g. `secret_setup_8f29c...`) |
| `SESSION_SECRET` | Secret key for signing HttpOnly cookies | A secure random string (minimum 32 characters) |
| `NODE_ENV` | Runtime environment | `production` |

---

## 3. Step-by-Step Deployment Instructions

### Step 1: Review and Test Locally
Open **PowerShell** in the project directory:
```powershell
cd "c:\Users\cvard\Downloads\Invoice_Generator_Resend_PIN_Reset\invoice generator"
npm test
```
All 20 test suites will run and pass, confirming serverless function routing, scrypt hashing, rate limiting, and single-use token consumption.

---

### Step 2: Push to a Private GitHub Repository
1. Initialize Git in the project root if not already done:
   ```powershell
   git init
   git add .
   git commit -m "feat: Vercel serverless architecture with MongoDB Atlas and Resend"
   ```
2. Verify that `.env` is **NOT** tracked:
   ```powershell
   git status
   ```
   *(Ensure `.env` does not appear in tracked files. It is protected by `.gitignore`)*.
3. Create a **Private Repository** on [GitHub](https://github.com/new).
4. Link your remote and push:
   ```powershell
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git branch -M main
   git push -u origin main
   ```

---

### Step 3: Configure MongoDB Atlas (Manual Dashboard Step)
1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas) and log in.
2. **Create a Cluster:**
   - Select **M0 Free Tier** (AWS, choose a region close to your Vercel deployment, e.g., `us-east-1` or `ap-south-1`).
3. **Create a Database User:**
   - Navigate to **Security → Database Access → Add New Database User**.
   - Authentication Method: **Password**.
   - Username: `invoice_app_user`.
   - Generate a secure password and store it safely.
   - Built-in Role: **Read and write to any database** (or restrict to `invoice_generator_auth`).
4. **Configure Network Access:**
   - Navigate to **Security → Network Access → Add IP Address**.
   - For serverless platforms like Vercel (where outgoing IPs are dynamic), add:
     - **IP:** `0.0.0.0/0` (Allow access from anywhere).
     - *Security Note:* While `0.0.0.0/0` allows Vercel functions to connect, your database remains protected by strong password authentication and TLS encryption. For advanced enterprise setups, MongoDB Atlas Network Peering or Private Endpoints can be used.
5. **Get Connection String:**
   - Go to **Deployments → Database → Connect → Drivers (Node.js)**.
   - Copy the URI:
     `mongodb+srv://invoice_app_user:<password>@cluster0.mongodb.net/?retryWrites=true&w=majority`
   - Replace `<password>` with your database user's password.
   - Append the database name before the `?`:
     `mongodb+srv://invoice_app_user:<password>@cluster0.mongodb.net/invoice_generator_auth?retryWrites=true&w=majority`

---

### Step 4: Configure Resend (Manual Dashboard Step)
1. Log in to [resend.com](https://resend.com).
2. **API Key:**
   - Go to **API Keys → Create API Key**.
   - Permission: **Sending access**.
   - Copy the key (`re_...`).
3. **Sender Domain:**
   - For initial testing, you can use `onboarding@resend.dev` (this sender can only deliver emails to your registered account: `nakshashreyas@gmail.com`).
   - For production, navigate to **Domains → Add Domain**, add your custom domain (e.g., `invoices.yourdomain.com`), and configure the DNS records (DKIM, SPF, MX) at your DNS registrar.

---

### Step 5: Deploy to Vercel (Manual Dashboard Step)
1. Log in to [vercel.com](https://vercel.com).
2. Click **Add New... → Project**.
3. Import your GitHub repository.
4. **Project Settings:**
   - **Framework Preset:** `Other` (or auto-detected).
   - **Root Directory:** If your repository root is `invoice generator`, click **Edit** and select `invoice generator` (or leave `./` if you pushed the `invoice generator` folder directly).
5. **Environment Variables:**
   Under **Environment Variables**, add each of the following:
   - `MONGODB_URI`: Your MongoDB Atlas connection string.
   - `MONGODB_DB`: `invoice_generator_auth`
   - `RESEND_API_KEY`: Your Resend API key (`re_...`).
   - `RESEND_FROM_EMAIL`: `onboarding@resend.dev` (or your verified domain).
   - `ADMIN_RESET_EMAIL`: `nakshashreyas@gmail.com`
   - `ADMIN_SETUP_SECRET`: A secret string you choose for first-run setup (e.g. `SetupAdmin2026!SecretKey`).
   - `SESSION_SECRET`: A random 32+ character string (e.g. `c7f93b5a1e8d4c2a0f6e8b4d2c0a8e6f1a3b5c7d9e`).
   - `APP_BASE_URL`: Initially `https://placeholder.vercel.app` (you will update this in step 7 once Vercel assigns your domain).
   - `NODE_ENV`: `production`
6. Click **Deploy**.
7. Once deployment finishes, copy your assigned Vercel domain (e.g., `https://invoice-generator-abc.vercel.app`).
8. Go to **Settings → Environment Variables**, update `APP_BASE_URL` with your actual Vercel HTTPS domain, and trigger a redeployment (**Deployments → Redeploy**).

---

### Step 6: Initial Administrator Setup
When your Vercel site is deployed for the first time, MongoDB Atlas contains no administrator record.

1. Open your Vercel production URL: `https://your-app.vercel.app`.
2. The interface will detect that no administrator PIN exists and display the setup modal.
3. Enter your desired 4-digit PIN and confirm it.
4. If you configured `ADMIN_SETUP_SECRET`, enter your secret passphrase in the **Administrator Setup Secret** input field. (Alternatively, visiting `https://your-app.vercel.app/?secret=your_setup_secret` will automatically populate the field).
5. Click **Set PIN**. The server cryptographically verifies the secret with constant-time equality, hashes the PIN using `scrypt`, permanently saves it to MongoDB Atlas, and issues a signed, `HttpOnly`, `SameSite=Lax`, `Secure` session cookie to your browser.
6. The application unlocks immediately.

---

### Step 7: Verify Cross-Browser and Cross-Device Functionality
1. **Laptop (Chrome):** Log in using the 4-digit PIN. It connects to MongoDB Atlas and unlocks.
2. **Laptop (Firefox / Edge / Incognito):** Open the same URL. Enter the 4-digit PIN. It connects to MongoDB Atlas and unlocks.
3. **Mobile Phone / Tablet (Safari / Chrome Mobile):** Open the same URL. Enter the 4-digit PIN. It unlocks seamlessly.
4. **Test PIN Reset:**
   - In any browser, click **Reset PIN by email**.
   - An email is sent to `nakshashreyas@gmail.com` via Resend with a single-use 15-minute link.
   - Open the link, enter a new 4-digit PIN.
   - MongoDB Atlas atomically updates the authoritative record and increments `session_version`.
   - Now, test entering the old PIN in another browser: it is **immediately rejected**.
   - Enter the new PIN: it **immediately unlocks**.

---

## 4. Credential Rotation & Recovery Procedures

### How to Rotate Secrets
1. **Rotate `SESSION_SECRET`:**
   - Update `SESSION_SECRET` in Vercel Project Settings.
   - Redeploy.
   - *Effect:* Immediately invalidates all active session cookies across all devices, requiring everyone to re-enter their 4-digit PIN.
2. **Rotate `RESEND_API_KEY`:**
   - Generate a new API key in Resend dashboard.
   - Update `RESEND_API_KEY` in Vercel Project Settings.
   - Delete the old key in Resend.
3. **Rotate MongoDB Password:**
   - In Atlas, navigate to **Database Access**, edit the user password.
   - Update `MONGODB_URI` in Vercel Project Settings.
   - Redeploy the application.
4. **Emergency Recovery if Administrator PIN is Forgotten:**
   - If email is inaccessible, an administrator with access to MongoDB Atlas can delete the document `{ _id: 'admin_pin_config' }` from the `admin_settings` collection.
   - Visit `/` and run first-time initialization with your `ADMIN_SETUP_SECRET`.
