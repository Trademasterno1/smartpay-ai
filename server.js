require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const { Pool } = require("pg");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

const workspaceContext = new AsyncLocalStorage();
const loginAttempts = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_COOKIE = "smartpay_session";
function getWorkspaceRole() { return workspaceContext.getStore()?.role === "judge" ? "judge" : "admin"; }
function workspaceTable(kind) {
  const judge = getWorkspaceRole() === "judge";
  const tables = {
    invoices: judge ? "judge_invoices" : "invoices",
    payments: judge ? "judge_payment_events" : "payment_events",
    merchant: judge ? "judge_merchant_settings" : "merchant_settings"
  };
  return tables[kind];
}
function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a || "")).digest();
  const right = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(left, right);
}
function signSession(payload) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
}
function parseSessionCookie(req) {
  const raw = String(req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith(SESSION_COOKIE + "="));
  return raw ? decodeURIComponent(raw.slice(SESSION_COOKIE.length + 1)) : "";
}
function getSessionFromRequest(req) {
  if (!process.env.SESSION_SECRET) return null;
  const value = parseSessionCookie(req);
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!signature || !safeEqual(signature, signSession(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!["admin", "judge"].includes(session.role) || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    return session;
  } catch (_) {
    return null;
  }
}
function requireConfiguredAuth(res) {
  if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD || !process.env.JUDGE_PASSWORD) {
    res.status(503).json({ error: "Secure sign-in is not configured. Please contact the administrator." });
    return false;
  }
  return true;
}
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/index.html", (_req, res) => res.redirect("/"));
app.post("/api/login", (req, res) => {
  if (!requireConfiguredAuth(res)) return;
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const attempt = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  if (attempt.resetAt <= Date.now()) { attempt.count = 0; attempt.resetAt = Date.now() + 15 * 60 * 1000; }
  if (attempt.count >= 5) return res.status(429).json({ error: "Too many sign-in attempts. Please wait 15 minutes and try again." });
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const adminMatch = safeEqual(username, process.env.ADMIN_USERNAME || "admin") && safeEqual(password, process.env.ADMIN_PASSWORD);
  const judgeMatch = safeEqual(username, process.env.JUDGE_USERNAME || "judge") && safeEqual(password, process.env.JUDGE_PASSWORD);
  if (!adminMatch && !judgeMatch) {
    attempt.count += 1; loginAttempts.set(ip, attempt);
    return res.status(401).json({ error: "The username or password is incorrect." });
  }
  loginAttempts.delete(ip);
  const role = adminMatch ? "admin" : "judge";
  const session = { role, expiresAt: Date.now() + SESSION_TTL_MS, nonce: crypto.randomBytes(24).toString("hex") };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const value = payload + "." + signSession(payload);
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + Math.floor(SESSION_TTL_MS / 1000));
  return res.json({ authenticated: true, role });
});
app.get("/api/session", (req, res) => {
  if (!requireConfiguredAuth(res)) return;
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ authenticated: false });
  return res.json({ authenticated: true, role: session.role, expiresAt: session.expiresAt });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
  return res.json({ loggedOut: true });
});
app.use("/api", (req, res, next) => {
  const publicExact = new Set(["/login", "/logout", "/session", "/config", "/health"]);
  if (publicExact.has(req.path) || req.path.startsWith("/public-invoices/")) return next();
  if (!requireConfiguredAuth(res)) return;
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin) {
      try {
        if (new URL(origin).origin !== req.protocol + "://" + req.get("host")) return res.status(403).json({ error: "Cross-site request blocked." });
      } catch (_) { return res.status(403).json({ error: "Invalid request origin." }); }
    }
  }
  req.user = { role: session.role };
  return workspaceContext.run({ role: session.role }, next);
});
app.use(express.static(path.join(__dirname, "public"), { index: false }));

const PORT = process.env.PORT || 3000;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5, connectionTimeoutMillis: 10000 })
  : null;
let databaseConnected = false;
let merchantProfile = { businessName: "", address: "", email: "", phone: "", taxNumber: "" };
function getMerchantProfile() { return getWorkspaceRole() === "judge" ? judgeMerchantProfile : merchantProfile; }
let judgeMerchantProfile = { businessName: "SmartPay Demo Merchant", address: "Demo workspace · no real merchant details", email: "demo@smartpay.example", phone: "", taxNumber: "" };
const judgeInvoices = [];
const PAYPAL_BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

const adminInvoices = [
  { id: "INV-1001", customer: "Northstar Studio", email: "billing@example.com", amount: "249.00", currency: "USD", status: "PAID", dueDate: "2026-11-05", paypalOrderId: "DEMO-ORDER-1001" },
  { id: "INV-1002", customer: "Green Leaf Cafe", email: "accounts@example.com", amount: "580.00", currency: "USD", status: "PAID", dueDate: "2026-11-08", paypalOrderId: null },
  { id: "INV-1003", customer: "Atlas Design Co.", email: "finance@example.com", amount: "125.50", currency: "USD", status: "OVERDUE", dueDate: "2026-10-28", paypalOrderId: null },
  { id: "INV-1004", customer: "BrightPath Learning", email: "office@example.com", amount: "920.00", currency: "USD", status: "UNPAID", dueDate: "2026-11-15", paypalOrderId: null }
];
const invoices = new Proxy(adminInvoices, {
  get(_target, property) {
    const active = getWorkspaceRole() === "judge" ? judgeInvoices : adminInvoices;
    const value = Reflect.get(active, property, active);
    return typeof value === "function" ? value.bind(active) : value;
  },
  set(_target, property, value) {
    const active = getWorkspaceRole() === "judge" ? judgeInvoices : adminInvoices;
    return Reflect.set(active, property, value, active);
  }
});

async function initializeDatabase() {
  if (!pool) {
    console.warn("DATABASE_URL is not configured; using temporary in-memory demo data.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      customer TEXT NOT NULL,
      email TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      due_date DATE NOT NULL,
      paypal_order_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_items JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS merchant_profile JSONB`);
  await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_token TEXT`);
  await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS invoices_payment_token_unique ON invoices(payment_token) WHERE payment_token IS NOT NULL`);
  await pool.query(`CREATE TABLE IF NOT EXISTS merchant_settings (id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), profile JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const merchantResult = await pool.query(`SELECT profile FROM merchant_settings WHERE id = 1`);
  if (merchantResult.rowCount) merchantProfile = { ...merchantProfile, ...merchantResult.rows[0].profile };
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_events (
      id BIGSERIAL PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      paypal_order_id TEXT,
      event_type TEXT NOT NULL,
      amount NUMERIC(12,2),
      currency TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Dedicated judge workspace tables. Additive only: admin invoices and payment history remain untouched.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS judge_invoices (
      id TEXT PRIMARY KEY,
      customer TEXT NOT NULL,
      email TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      due_date DATE NOT NULL,
      paypal_order_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      merchant_profile JSONB,
      payment_token TEXT
    )
  `);
  await pool.query(`ALTER TABLE judge_invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS judge_invoices_payment_token_unique ON judge_invoices(payment_token) WHERE payment_token IS NOT NULL`);
  await pool.query(`CREATE TABLE IF NOT EXISTS judge_merchant_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS judge_payment_events (
      id BIGSERIAL PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES judge_invoices(id),
      paypal_order_id TEXT,
      event_type TEXT NOT NULL,
      amount NUMERIC(12,2),
      currency TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Illustrative historical collections live outside the PayPal payment ledger.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS judge_demo_collections (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL UNIQUE REFERENCES judge_invoices(id),
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'SIMULATED DEMO COLLECTION',
      created_at TIMESTAMPTZ NOT NULL
    )
  `);
  const judgeProfileResult = await pool.query(`SELECT profile FROM judge_merchant_settings WHERE id = 1`);
  if (judgeProfileResult.rowCount) judgeMerchantProfile = { ...judgeMerchantProfile, ...judgeProfileResult.rows[0].profile };
  else await pool.query(
    `INSERT INTO judge_merchant_settings (id, profile) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(judgeMerchantProfile)]
  );
  const judgeSeed = [
    { id: "JUDGE-INV-2001", customer: "Atlas Design Demo", email: "accounts@atlas-demo.example", amount: "125.50", currency: "USD", status: "UNPAID", dueDate: "2026-11-04", lineItems: [{ description: "Brand strategy package", quantity: 1, unitPrice: "125.50", lineTotal: "125.50" }] },
    { id: "JUDGE-INV-2002", customer: "BrightPath Learning Demo", email: "finance@brightpath-demo.example", amount: "920.00", currency: "USD", status: "UNPAID", dueDate: "2026-11-15", lineItems: [{ description: "Learning platform services", quantity: 1, unitPrice: "920.00", lineTotal: "920.00" }] },
    { id: "JUDGE-INV-2003", customer: "Northstar Studio Demo", email: "billing@northstar-demo.example", amount: "249.00", currency: "USD", status: "UNPAID", dueDate: "2026-11-26", lineItems: [{ description: "Creative production", quantity: 1, unitPrice: "249.00", lineTotal: "249.00" }] },
    { id: "JUDGE-DEMO-PAID-2004", customer: "Demo · Meridian Creative", email: "accounts@meridian-demo.example", amount: "640.00", currency: "USD", status: "PAID", dueDate: "2026-08-20", lineItems: [{ description: "Brand identity project", quantity: 1, unitPrice: "640.00", lineTotal: "640.00" }] },
    { id: "JUDGE-DEMO-PAID-2005", customer: "Demo · Cedar & Stone", email: "finance@cedarstone-demo.example", amount: "1280.00", currency: "USD", status: "PAID", dueDate: "2026-09-12", lineItems: [{ description: "Consulting services", quantity: 4, unitPrice: "320.00", lineTotal: "1280.00" }] },
    { id: "JUDGE-DEMO-PAID-2006", customer: "Demo · BluePeak Media", email: "billing@bluepeak-demo.example", amount: "375.00", currency: "USD", status: "PAID", dueDate: "2026-10-22", lineItems: [{ description: "Campaign production", quantity: 1, unitPrice: "375.00", lineTotal: "375.00" }] },
    { id: "JUDGE-DEMO-OVERDUE-2007", customer: "Demo · Urban Desk Co.", email: "accounts@urbandesk-demo.example", amount: "890.00", currency: "USD", status: "UNPAID", dueDate: "2026-10-18", lineItems: [{ description: "Workspace fit-out services", quantity: 1, unitPrice: "890.00", lineTotal: "890.00" }] },
    { id: "JUDGE-DEMO-OVERDUE-2008", customer: "Demo · Nova Wellness", email: "finance@novawellness-demo.example", amount: "2450.00", currency: "USD", status: "UNPAID", dueDate: "2026-11-02", lineItems: [{ description: "Monthly service package", quantity: 1, unitPrice: "2450.00", lineTotal: "2450.00" }] },
    { id: "JUDGE-DEMO-UPCOMING-2009", customer: "Demo · Summit Works", email: "billing@summitworks-demo.example", amount: "510.00", currency: "USD", status: "UNPAID", dueDate: "2026-11-18", lineItems: [{ description: "Operations support", quantity: 1, unitPrice: "510.00", lineTotal: "510.00" }] },
    { id: "JUDGE-DEMO-UPCOMING-2010", customer: "Demo · Olive Branch Design", email: "accounts@olivebranch-demo.example", amount: "1750.00", currency: "USD", status: "UNPAID", dueDate: "2026-12-05", lineItems: [{ description: "Website and e-commerce project", quantity: 1, unitPrice: "1750.00", lineTotal: "1750.00" }] },
    { id: "JUDGE-DEMO-UPCOMING-2011", customer: "Demo · Atlas Learning Hub", email: "finance@atlaslearning-demo.example", amount: "3200.00", currency: "USD", status: "UNPAID", dueDate: "2027-01-12", lineItems: [{ description: "Quarterly training program", quantity: 2, unitPrice: "1600.00", lineTotal: "3200.00" }] }
  ];
  for (const sample of judgeSeed) {
    await pool.query(
      `INSERT INTO judge_invoices (id, customer, email, amount, currency, status, due_date, line_items, merchant_profile, payment_token, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,
               LEAST($7::date - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day'))
       ON CONFLICT (id) DO UPDATE SET created_at = EXCLUDED.created_at`,
      [sample.id, sample.customer, sample.email, sample.amount, sample.currency, sample.status, sample.dueDate,
       JSON.stringify(sample.lineItems), JSON.stringify(judgeMerchantProfile), crypto.randomBytes(32).toString("hex")]
    );
  }
  const judgeDemoCollections = [
    { id: "JUDGE-DEMO-COLLECT-2004", invoiceId: "JUDGE-DEMO-PAID-2004", amount: "640.00", currency: "USD", capturedAt: "2026-08-18T12:00:00Z" },
    { id: "JUDGE-DEMO-COLLECT-2005", invoiceId: "JUDGE-DEMO-PAID-2005", amount: "1280.00", currency: "USD", capturedAt: "2026-09-10T12:00:00Z" },
    { id: "JUDGE-DEMO-COLLECT-2006", invoiceId: "JUDGE-DEMO-PAID-2006", amount: "375.00", currency: "USD", capturedAt: "2026-10-20T12:00:00Z" }
  ];
  for (const demoCollection of judgeDemoCollections) {
    await pool.query(
      `INSERT INTO judge_demo_collections (id, invoice_id, amount, currency, label, created_at)
       VALUES ($1,$2,$3,$4,'SIMULATED DEMO COLLECTION',$5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount,
         currency = EXCLUDED.currency, label = EXCLUDED.label, created_at = EXCLUDED.created_at`,
      [demoCollection.id, demoCollection.invoiceId, demoCollection.amount, demoCollection.currency, demoCollection.capturedAt]
    );
  }
  const judgeResult = await pool.query(
    `SELECT id, customer, email, amount::text, currency, status, tax_rate::text AS "taxRate",
            to_char(due_date, 'YYYY-MM-DD') AS "dueDate", paypal_order_id AS "paypalOrderId",
            line_items AS "lineItems", merchant_profile AS "merchantProfile",
            payment_token AS "paymentToken"
     FROM judge_invoices ORDER BY due_date, id`
  );
  judgeInvoices.splice(0, judgeInvoices.length, ...judgeResult.rows);
  console.log("Judge demo workspace ready; loaded " + judgeInvoices.length + " isolated demo invoices.");
  for (const invoice of invoices) {
    await pool.query(
      `INSERT INTO invoices (id, customer, email, amount, currency, status, due_date, paypal_order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [invoice.id, invoice.customer, invoice.email, invoice.amount, invoice.currency, invoice.status, invoice.dueDate, invoice.paypalOrderId]
    );
  }
  const invoicesWithoutTokens = await pool.query(`SELECT id FROM invoices WHERE payment_token IS NULL`);
  for (const row of invoicesWithoutTokens.rows) {
    await pool.query(`UPDATE invoices SET payment_token=$2 WHERE id=$1 AND payment_token IS NULL`, [row.id, crypto.randomBytes(32).toString("hex")]);
  }
  const result = await pool.query(
    `SELECT id, customer, email, amount::text, currency, status, tax_rate::text AS "taxRate",
            to_char(due_date, 'YYYY-MM-DD') AS "dueDate", paypal_order_id AS "paypalOrderId",
            line_items AS "lineItems", merchant_profile AS "merchantProfile",
            payment_token AS "paymentToken"
     FROM invoices ORDER BY due_date, id`
  );
  invoices.splice(0, invoices.length, ...result.rows);
  databaseConnected = true;
  console.log("PostgreSQL connected; loaded " + invoices.length + " invoices.");
}

async function persistInvoice(invoice) {
  if (!pool) return;
  const table = workspaceTable("invoices");
  await pool.query(
    `INSERT INTO ${table} (id, customer, email, amount, currency, status, due_date, paypal_order_id, payment_token, tax_rate, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (id) DO UPDATE SET customer=EXCLUDED.customer, email=EXCLUDED.email,
       amount=EXCLUDED.amount, currency=EXCLUDED.currency, status=EXCLUDED.status,
       due_date=EXCLUDED.due_date, paypal_order_id=EXCLUDED.paypal_order_id,
       tax_rate=EXCLUDED.tax_rate,
       payment_token=COALESCE(${table}.payment_token, EXCLUDED.payment_token), updated_at=NOW()`,
    [invoice.id, invoice.customer, invoice.email, invoice.amount, invoice.currency, invoice.status, invoice.dueDate, invoice.paypalOrderId, invoice.paymentToken || null, Number(invoice.taxRate || 0)]
  );
}

async function recordPaymentEvent(invoice, orderId, capture) {
  if (!pool) return;
  const table = workspaceTable("payments");
  await pool.query(
    `INSERT INTO ${table} (invoice_id, paypal_order_id, event_type, amount, currency, details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [invoice.id, orderId, "PAYMENT_CAPTURED", capture?.amount?.value || invoice.amount,
     capture?.amount?.currency_code || invoice.currency, JSON.stringify({ captureId: capture?.id || null, status: capture?.status || null })]
  );
}

let paypalTokenCache = { token: null, expiresAt: 0 };

const GEMINI_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const GROQ_FALLBACK_STATUS = new Set([400, 403, 404, 429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retryableStatuses, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
      if (!retryableStatuses.has(response.status) || attempt === maxRetries) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : Math.min(1000 * (2 ** attempt), 3000);
      console.warn("AI provider temporarily unavailable (HTTP " + response.status + "). Retrying.");
      await wait(delayMs);
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      await wait(Math.min(1000 * (2 ** attempt), 3000));
    }
  }
  throw lastError || new Error("AI provider is temporarily unavailable. Please try again shortly.");
}

const SMARTPAY_AI_SYSTEM_INSTRUCTION = "You are SmartPay AI, an accounts-receivable intelligence assistant for the SmartPay AI demonstration workspace. Use only facts in the supplied invoice data and clearly label recommendations. Treat PAID as collected; UNPAID and OVERDUE as outstanding. For collection-risk reviews, account for every outstanding invoice exactly once, exclude PAID invoices, rank overdue first, then due today or within 7 days, then later-due invoices. Use the supplied daysPastDue, daysUntilDue, dueDateValid, and collectionWindow fields as authoritative calculations; do not recalculate dates or call a future-due invoice overdue. Explain each risk level with specific invoice evidence and a practical next action. Use HIGH only for overdue invoices, MEDIUM for invoices due today or within 7 days, and LOW for later-due invoices; if dueDateValid is false, explicitly flag the missing/invalid date and recommend verification rather than pretending a date exists. Consider amount as financial exposure, not as evidence of default. Do not invent payment history, customer behavior, promises, probabilities, or percentages. Never invent URLs, payment dates, customer communications, fees, penalties, contract terms, or merchant policies. Never print, quote, or generate a payment URL or any raw web link in an answer. The application displays the secure action button separately. For each invoice, recommend exactly one action based on supplied facts: if status is PAID, say to view or save the invoice PDF; if outstanding and paymentLinkAvailable is true, recommend collecting payment; if outstanding and paymentLinkAvailable is false, recommend preparing a reminder. Never recommend collecting a PAID invoice or reminding a customer whose invoice is PAID. A PayPal order ID is an internal reference, never a customer payment link. This application provides recommendations only: it cannot schedule reminders, send customer messages, make phone calls, or execute collection actions. Never imply any of those actions were scheduled, sent, called, or completed. Phrase them as actions the merchant may take manually. Never use wording such as 'schedule a reminder' or imply that reminders can be scheduled; say 'plan to manually send a reminder' instead. Do not claim a reminder was sent or payment collected. Keep currencies separate and do not sum unlike currencies. When the user's question asks about invoice status, collections, priorities, or what to do next, return one clearly labeled invoice block for each invoice discussed so the interface can attach the matching action button. For collection-risk reviews, return a concise, complete report with exactly one clearly labeled block per outstanding invoice. Do NOT use a Markdown table. Use this fixed format for every invoice: INVOICE: [exact invoice ID]; CUSTOMER: [name]; AMOUNT: [amount and currency]; STATUS: [status]; DUE DATE: [date or not recorded]; TIMING: [supplied daysPastDue or daysUntilDue]; RISK: [HIGH/MEDIUM/LOW]; EVIDENCE: [specific supplied facts]; NEXT ACTION: [one practical action]. Repeat the block until every outstanding invoice is covered exactly once. Copy each invoice ID exactly as supplied. After all invoice blocks, add a section with the exact heading `Prioritized Merchant Actions:` followed by exactly three numbered actions (1., 2., 3.). Keep each field concise, never omit an invoice to save space, and do not use a table. If the supplied data is incomplete, state exactly what is missing.";

async function askGroq(question, context) {
  const response = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      temperature: 0.2,
      max_completion_tokens: 3500,
      messages: [
        { role: "system", content: SMARTPAY_AI_SYSTEM_INSTRUCTION },
        { role: "user", content: "Invoice data: " + context + "\nUser question: " + question }
      ]
    })
  }, GROQ_FALLBACK_STATUS);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || "Groq AI request failed.");
    error.status = response.status;
    throw error;
  }
  const choice = data.choices?.[0];
  const answer = choice?.message?.content;
  if (!answer) throw new Error("Groq returned an empty response.");
  if (choice.finish_reason === "length") throw new Error("Groq response reached its output limit; trying the fallback provider.");
  return answer;
}

async function askGemini(question, context) {
  if (!process.env.GEMINI_API_KEY) throw new Error("Gemini fallback is not configured.");
  const response = await fetchWithRetry(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + encodeURIComponent(process.env.GEMINI_API_KEY),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SMARTPAY_AI_SYSTEM_INSTRUCTION }] },
        generationConfig: { temperature: 0.2, maxOutputTokens: 3000 },
        contents: [{ parts: [{ text: "Invoice data: " + context + "\nUser question: " + question }] }]
      })
    },
    GEMINI_RETRYABLE_STATUS
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || "Gemini AI request failed.");
    error.status = response.status;
    throw error;
  }
  const candidate = data.candidates?.[0];
  const answer = candidate?.content?.parts?.map(part => part.text || "").join("\n");
  if (!answer) throw new Error("Gemini returned an empty response.");
  if (candidate.finishReason === "MAX_TOKENS") throw new Error("Gemini response reached its output limit.");
  return answer;
}

async function getPayPalAccessToken() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal Sandbox credentials are not configured on the server.");
  }
  if (paypalTokenCache.token && Date.now() < paypalTokenCache.expiresAt) return paypalTokenCache.token;
  const auth = Buffer.from(process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_CLIENT_SECRET).toString("base64");
  const response = await fetch(PAYPAL_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || "PayPal authentication failed.");
  paypalTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

app.get("/api/config", (_req, res) => {
  res.json({ paypalClientId: process.env.PAYPAL_CLIENT_ID || "", currency: "USD", mode: process.env.PAYPAL_ENV || "sandbox" });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "SmartPay AI", paypalConfigured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET), databaseConfigured: Boolean(pool), databaseConnected });
});


app.get("/api/invoices", (_req, res) => res.json(invoices));

app.get("/api/merchant-profile", (_req, res) => res.json(getMerchantProfile()));

app.put("/api/merchant-profile", async (req, res) => {
  try {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "The Judge Demo account cannot change merchant settings." });
    const fields = ["businessName", "address", "email", "phone", "taxNumber"];
    const limits = { businessName: 120, address: 300, email: 254, phone: 40, taxNumber: 40 };
    const updated = {};
    for (const field of fields) {
      updated[field] = String(req.body[field] || "").trim();
      if (updated[field].length > limits[field]) return res.status(400).json({ error: field + " is too long." });
    }
    if (!updated.businessName) return res.status(400).json({ error: "Enter the merchant or business name." });
    if (updated.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updated.email)) return res.status(400).json({ error: "Enter a valid business email address." });
    if (pool && databaseConnected) await pool.query(`INSERT INTO merchant_settings (id, profile, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW()`, [JSON.stringify(updated)]);
    merchantProfile = updated;
    return res.json({ profile: merchantProfile, saved: true });
  } catch (error) {
    console.error("Merchant profile save failed:", error.message);
    return res.status(500).json({ error: "Could not save merchant details." });
  }
});

app.get("/api/analytics/monthly", async (req, res) => {
  try {
    if (!pool || !databaseConnected) return res.status(503).json({ error: "Monthly analytics are unavailable because the database is not connected." });
    const requestedMonths = Number.parseInt(req.query.months, 10);
    const months = requestedMonths === 12 ? 12 : 6;
    const result = await pool.query(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', CURRENT_DATE) - (($1::int - 1) * interval '1 month'),
           date_trunc('month', CURRENT_DATE),
           interval '1 month'
         ) AS month_start
       ),
       date_bounds AS (
         SELECT MIN(month_start) AS first_month,
                MAX(month_start) + interval '1 month' AS after_last_month
         FROM months
       ),
       currencies AS (
         SELECT DISTINCT UPPER(currency) AS currency
         FROM ${workspaceTable("invoices")}, date_bounds
         WHERE created_at >= date_bounds.first_month
           AND created_at < date_bounds.after_last_month
         UNION
         SELECT DISTINCT UPPER(currency) AS currency
         FROM ${workspaceTable("payments")}, date_bounds
         WHERE event_type = 'PAYMENT_CAPTURED'
           AND created_at >= date_bounds.first_month
           AND created_at < date_bounds.after_last_month
         ${getWorkspaceRole() === "judge" ? `
         UNION
         SELECT DISTINCT UPPER(currency) AS currency
         FROM judge_demo_collections, date_bounds
         WHERE created_at >= date_bounds.first_month
           AND created_at < date_bounds.after_last_month` : ""}
       ),
       invoice_totals AS (
         SELECT date_trunc('month', created_at) AS month_start,
                UPPER(currency) AS currency,
                SUM(amount)::numeric(14,2)::text AS amount,
                COUNT(*)::int AS invoice_count
         FROM ${workspaceTable("invoices")}
         WHERE created_at >= (SELECT first_month FROM date_bounds)
           AND created_at < (SELECT after_last_month FROM date_bounds)
         GROUP BY 1, 2
       ),
       payment_totals AS (
         SELECT date_trunc('month', created_at) AS month_start,
                UPPER(currency) AS currency,
                SUM(amount)::numeric(14,2)::text AS amount,
                COUNT(*)::int AS payment_count
         FROM ${workspaceTable("payments")}
         WHERE event_type = 'PAYMENT_CAPTURED'
           AND created_at >= (SELECT first_month FROM date_bounds)
           AND created_at < (SELECT after_last_month FROM date_bounds)
         GROUP BY 1, 2
       ),
       demo_payment_totals AS (
         ${getWorkspaceRole() === "judge" ? `
         SELECT date_trunc('month', created_at) AS month_start,
                UPPER(currency) AS currency,
                SUM(amount)::numeric(14,2)::text AS amount,
                COUNT(*)::int AS payment_count
         FROM judge_demo_collections
         WHERE created_at >= (SELECT first_month FROM date_bounds)
           AND created_at < (SELECT after_last_month FROM date_bounds)
         GROUP BY 1, 2` : `
         SELECT NULL::timestamp AS month_start, NULL::text AS currency,
                '0.00'::text AS amount, 0::int AS payment_count WHERE FALSE`}
       )
       SELECT to_char(months.month_start, 'Mon YY') AS label,
              currencies.currency AS currency,
              COALESCE(invoice_totals.amount, '0.00') AS "invoicedAmount",
              COALESCE(payment_totals.amount, '0.00') AS "collectedAmount",
              COALESCE(demo_payment_totals.amount, '0.00') AS "demoCollectedAmount",
              COALESCE(invoice_totals.invoice_count, 0) AS "invoiceCount",
              COALESCE(payment_totals.payment_count, 0) AS "paymentCount",
              COALESCE(demo_payment_totals.payment_count, 0) AS "demoPaymentCount"
       FROM months
       CROSS JOIN currencies
       LEFT JOIN invoice_totals
         ON invoice_totals.month_start = months.month_start
        AND invoice_totals.currency = currencies.currency
       LEFT JOIN payment_totals
         ON payment_totals.month_start = months.month_start
        AND payment_totals.currency = currencies.currency
       LEFT JOIN demo_payment_totals
         ON demo_payment_totals.month_start = months.month_start
        AND demo_payment_totals.currency = currencies.currency
       ORDER BY currencies.currency, months.month_start`,
      [months]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Monthly analytics lookup failed:", error.message);
    return res.status(500).json({ error: "Could not load monthly analytics." });
  }
});

app.get("/api/payments", async (_req, res) => {
  try {
    if (!pool || !databaseConnected) return res.status(503).json({ error: "Payment history is unavailable because the database is not connected." });
    const result = await pool.query(
      `SELECT pe.id, pe.invoice_id AS "invoiceId", i.customer,
              pe.paypal_order_id AS "paypalOrderId", pe.event_type AS "eventType",
              pe.amount::text AS amount, pe.currency,
              pe.details->>'captureId' AS "captureId",
              pe.details->>'status' AS "paypalStatus",
              pe.created_at AS "createdAt"
       FROM ${workspaceTable("payments")} pe
       JOIN ${workspaceTable("invoices")} i ON i.id = pe.invoice_id
       ORDER BY pe.created_at DESC
       LIMIT 100`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Payment history lookup failed:", error.message);
    return res.status(500).json({ error: "Could not load payment history." });
  }
});

function validateInvoiceLineItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 50) return { error: "Add between 1 and 50 invoice items." };
  const items = [];
  let totalCents = 0;
  for (const raw of rawItems) {
    const description = String(raw?.description || "").trim();
    const quantityInput = String(raw?.quantity ?? "").trim();
    const priceInput = String(raw?.unitPrice ?? "").trim();
    const quantity = Number(quantityInput), unitPrice = Number(priceInput);
    if (!description || description.length > 300) return { error: "Each item needs a description (maximum 300 characters)." };
    if (!/^\d{1,6}(\.\d{1,3})?$/.test(quantityInput) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 999999) return { error: "Enter a valid quantity greater than zero (up to 3 decimals)." };
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(priceInput) || !Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 99999999.99) return { error: "Enter a valid unit price greater than zero (up to 2 decimals)." };
    const lineCents = Math.round(quantity * unitPrice * 100);
    if (!Number.isSafeInteger(lineCents) || lineCents <= 0) return { error: "An item total is invalid." };
    totalCents += lineCents;
    items.push({ description, quantity, unitPrice: unitPrice.toFixed(2), lineTotal: (lineCents / 100).toFixed(2) });
  }
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > 9999999999) return { error: "The invoice total is outside the supported range." };
  return { items, amount: (totalCents / 100).toFixed(2) };
}

app.post("/api/invoices", async (req, res) => {
  try {
    if (!pool || !databaseConnected) return res.status(503).json({ error: "Persistent database is unavailable. No invoice was created." });
    const activeMerchantProfile = getMerchantProfile();
    if (!activeMerchantProfile.businessName) return res.status(400).json({ error: "Save the merchant details before issuing an invoice." });
    const customer = String(req.body.customer || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const dueDate = String(req.body.dueDate || "").trim();
    const validatedItems = validateInvoiceLineItems(req.body.lineItems);
    if (validatedItems.error) return res.status(400).json({ error: validatedItems.error });
    const subtotal = Number(validatedItems.amount);
    const taxRate = Number(req.body.taxRate ?? 0);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return res.status(400).json({ error: "Tax must be a percentage between 0 and 100." });
    const taxCents = Math.round(subtotal * taxRate);
    const amount = (Math.round(subtotal * 100) + taxCents) / 100;
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && !Number.isNaN(Date.parse(dueDate + "T00:00:00Z")) && new Date(dueDate + "T00:00:00Z").toISOString().slice(0, 10) === dueDate;
    if (!customer || customer.length > 120) return res.status(400).json({ error: "Enter a customer name (maximum 120 characters)." });
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) return res.status(400).json({ error: "Enter a valid customer email address, or leave it blank." });
    if (!Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) return res.status(400).json({ error: "The invoice total exceeds the supported amount." });
    if (!validDate) return res.status(400).json({ error: "Choose a valid due date." });
    const invoice = {
      id: "INV-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
      customer, email, amount: amount.toFixed(2), taxRate: taxRate.toFixed(2), lineItems: validatedItems.items, merchantProfile: { ...activeMerchantProfile }, currency: "USD", status: "UNPAID", dueDate, paypalOrderId: null,
      paymentToken: crypto.randomBytes(32).toString("hex")
    };
    await pool.query(
      `INSERT INTO ${workspaceTable("invoices")} (id, customer, email, amount, currency, status, due_date, paypal_order_id, line_items, merchant_profile, payment_token, tax_rate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)`,
      [invoice.id, invoice.customer, invoice.email, invoice.amount, invoice.currency, invoice.status, invoice.dueDate, null, JSON.stringify(invoice.lineItems), JSON.stringify(invoice.merchantProfile), invoice.paymentToken, invoice.taxRate]
    );
    invoices.push(invoice);
    console.log("Created invoice " + invoice.id + " and saved it to PostgreSQL.");
    return res.status(201).json({ invoice });
  } catch (error) {
    console.error("Invoice creation failed:", error.message);
    return res.status(500).json({ error: "Could not save the invoice. Please try again." });
  }
});




app.put("/api/invoices/:id", async (req, res) => {
  try {
    if (!pool || !databaseConnected) return res.status(503).json({ error: "Persistent database is unavailable. No changes were saved." });
    const invoice = invoices.find(item => item.id === req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found." });
    if (invoice.status === "PAID") return res.status(409).json({ error: "Paid invoices cannot be edited." });
    if (invoice.paypalOrderId) return res.status(409).json({ error: "This invoice already has a PayPal order. Editing is locked to protect the checkout amount." });
    const customer = String(req.body.customer || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const dueDate = String(req.body.dueDate || "").trim();
    const validatedItems = validateInvoiceLineItems(req.body.lineItems);
    if (validatedItems.error) return res.status(400).json({ error: validatedItems.error });
    const subtotal = Number(validatedItems.amount);
    const taxRate = Number(req.body.taxRate ?? 0);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return res.status(400).json({ error: "Tax must be a percentage between 0 and 100." });
    const taxCents = Math.round(subtotal * taxRate);
    const amount = (Math.round(subtotal * 100) + taxCents) / 100;
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && !Number.isNaN(Date.parse(dueDate + "T00:00:00Z")) && new Date(dueDate + "T00:00:00Z").toISOString().slice(0, 10) === dueDate;
    if (!customer || customer.length > 120) return res.status(400).json({ error: "Enter a customer name (maximum 120 characters)." });
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) return res.status(400).json({ error: "Enter a valid customer email address, or leave it blank." });
    if (!Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) return res.status(400).json({ error: "The invoice total exceeds the supported amount." });
    if (!validDate) return res.status(400).json({ error: "Choose a valid due date." });
    const updated = await pool.query(
      `UPDATE ${workspaceTable("invoices")} SET customer=$2, email=$3, amount=$4, tax_rate=$5, due_date=$6, line_items=$7::jsonb, updated_at=NOW()
       WHERE id=$1 AND status <> 'PAID' AND paypal_order_id IS NULL
       RETURNING id, customer, email, amount::text, currency, status, tax_rate::text AS "taxRate",
                 to_char(due_date, 'YYYY-MM-DD') AS "dueDate", paypal_order_id AS "paypalOrderId",
                 line_items AS "lineItems"`,
      [invoice.id, customer, email, amount.toFixed(2), taxRate.toFixed(2), dueDate, JSON.stringify(validatedItems.items)]
    );
    if (!updated.rowCount) return res.status(409).json({ error: "Invoice could not be edited. It may have been paid or linked to a PayPal order." });
    Object.assign(invoice, updated.rows[0]);
    console.log("Updated invoice " + invoice.id + " in PostgreSQL.");
    return res.json({ invoice });
  } catch (error) {
    console.error("Invoice update failed:", error.message);
    return res.status(500).json({ error: "Could not update the invoice. Please try again." });
  }
});

app.delete("/api/invoices/:id", async (req, res) => {
  try {
    if (!pool || !databaseConnected) return res.status(503).json({ error: "Persistent database is unavailable. No invoice was deleted." });
    const invoice = invoices.find(item => item.id === req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found." });
    if (invoice.status === "PAID" || invoice.paypalOrderId) return res.status(409).json({ error: "Paid invoices or invoices linked to a PayPal order cannot be deleted." });
    const table = workspaceTable("invoices");
    const paymentTable = workspaceTable("payments");
    const deleted = await pool.query(
      "DELETE FROM " + table + " i WHERE i.id = $1 AND i.status <> 'PAID' AND i.paypal_order_id IS NULL AND NOT EXISTS (SELECT 1 FROM " + paymentTable + " p WHERE p.invoice_id = i.id) RETURNING i.id",
      [invoice.id]
    );
    if (!deleted.rowCount) return res.status(409).json({ error: "This invoice has payment history or is no longer eligible for deletion." });
    const index = invoices.findIndex(item => item.id === invoice.id);
    if (index >= 0) invoices.splice(index, 1);
    console.log("Deleted unpaid invoice " + invoice.id + " from the active workspace.");
    return res.json({ deleted: true, invoiceId: invoice.id });
  } catch (error) {
    console.error("Invoice deletion failed:", error.message);
    return res.status(500).json({ error: "Could not delete the invoice. Please try again." });
  }
});
async function createPayPalOrderForInvoice(invoice, applicationContext = null) {
  const token = await getPayPalAccessToken();
  const response = await fetch(PAYPAL_BASE + "/v2/checkout/orders", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: invoice.id,
        description: "SmartPay AI invoice " + invoice.id,
        amount: { currency_code: invoice.currency, value: invoice.amount }
      }],
      ...(applicationContext ? { application_context: applicationContext } : {})
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Could not create PayPal order.");
    error.status = response.status;
    throw error;
  }
  const approvalHref = data.links?.find(link => link.rel === "approve" || link.rel === "payer-action")?.href;
  if (!data.id || !approvalHref) throw new Error("PayPal did not return a valid checkout approval link.");
  const parsedUrl = new URL(approvalHref);
  if (parsedUrl.protocol !== "https:" || !["paypal.com", "www.paypal.com", "www.sandbox.paypal.com"].includes(parsedUrl.hostname)) {
    throw new Error("PayPal returned an unexpected checkout URL.");
  }
  invoice.paypalOrderId = data.id;
  await persistInvoice(invoice);
  return { id: data.id, approvalUrl: approvalHref };
}


app.use("/api/public-invoices/:token", (req, res, next) => {
  const token = req.params.token;
  const adminInvoice = adminInvoices.find(item => item.paymentToken && item.paymentToken === token);
  const judgeInvoice = judgeInvoices.find(item => item.paymentToken && item.paymentToken === token);
  const role = adminInvoice ? "admin" : judgeInvoice ? "judge" : "admin";
  return workspaceContext.run({ role }, next);
});
app.get("/api/public-invoices/:token", (req, res) => {
  const invoice = invoices.find(item => item.paymentToken && item.paymentToken === req.params.token);
  if (!invoice) return res.status(404).json({ error: "This invoice link is invalid or has expired." });
  return res.json({
    id: invoice.id, customer: invoice.customer, amount: invoice.amount, currency: invoice.currency,
    taxRate: Number(invoice.taxRate || 0), status: invoice.status, dueDate: invoice.dueDate, lineItems: invoice.lineItems || [],
    merchantProfile: invoice.merchantProfile || {}
  });
});

app.post("/api/public-invoices/:token/create-order", async (req, res) => {
  try {
    if (getWorkspaceRole() === "judge" && PAYPAL_BASE !== "https://api-m.sandbox.paypal.com") return res.status(403).json({ error: "Judge Demo checkout is restricted to PayPal Sandbox." });
    const invoice = invoices.find(item => item.paymentToken && item.paymentToken === req.params.token);
    if (!invoice) return res.status(404).json({ error: "This invoice link is invalid or has expired." });
    if (invoice.status === "PAID") return res.status(409).json({ error: "This invoice has already been paid." });
    const publicUrl = "https://smartpay-ai-upps.onrender.com/pay/" + encodeURIComponent(invoice.paymentToken);
    const order = await createPayPalOrderForInvoice(invoice, {
      return_url: publicUrl + "?payment=success",
      cancel_url: publicUrl + "?payment=cancelled",
      user_action: "PAY_NOW"
    });
    return res.json({ approvalUrl: order.approvalUrl, orderId: order.id });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Could not start PayPal checkout." });
  }
});

app.post("/api/public-invoices/:token/capture", async (req, res) => {
  try {
    if (getWorkspaceRole() === "judge" && PAYPAL_BASE !== "https://api-m.sandbox.paypal.com") return res.status(403).json({ error: "Judge Demo checkout is restricted to PayPal Sandbox." });
    const invoice = invoices.find(item => item.paymentToken && item.paymentToken === req.params.token);
    if (!invoice) return res.status(404).json({ error: "This invoice link is invalid or has expired." });
    const orderId = String(req.body.orderId || "");
    if (!orderId || invoice.paypalOrderId !== orderId) return res.status(403).json({ error: "This payment does not belong to this invoice." });
    if (invoice.status === "PAID") return res.json({ status: "COMPLETED", invoiceId: invoice.id, alreadyPaid: true });
    const token = await getPayPalAccessToken();
    const response = await fetch(PAYPAL_BASE + "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: data.message || "Payment capture failed." });
    const purchaseUnit = data.purchase_units?.[0];
    const capture = purchaseUnit?.payments?.captures?.[0];
    const capturedAmount = capture?.amount;
    const matchesInvoice = purchaseUnit?.reference_id === invoice.id &&
      capturedAmount?.currency_code === invoice.currency && capturedAmount?.value === invoice.amount;
    if (data.status !== "COMPLETED" || capture?.status !== "COMPLETED" || !matchesInvoice) {
      return res.status(409).json({ error: "PayPal has not confirmed a completed payment matching this invoice." });
    }
    invoice.status = "PAID";
    await persistInvoice(invoice);
    await recordPaymentEvent(invoice, orderId, capture);
    return res.json({ status: "COMPLETED", invoiceId: invoice.id, amount: capturedAmount.value, currency: capturedAmount.currency_code });
  } catch (error) {
    console.error("Public PayPal capture failed:", error.message);
    return res.status(500).json({ error: "Unable to verify this payment. Please contact the merchant." });
  }
});

app.post("/api/paypal/create-order", async (req, res) => {
  try {
    if (getWorkspaceRole() === "judge" && PAYPAL_BASE !== "https://api-m.sandbox.paypal.com") return res.status(403).json({ error: "Judge Demo checkout is restricted to PayPal Sandbox." });
    const invoice = invoices.find(item => item.id === req.body.invoiceId);
    if (!invoice) return res.status(404).json({ error: "Invoice not found." });
    if (invoice.status === "PAID") return res.status(400).json({ error: "This invoice is already paid." });
    const order = await createPayPalOrderForInvoice(invoice);
    res.json(order);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not create PayPal checkout." });
  }
});

app.post("/api/paypal/capture-order", async (req, res) => {
  try {
    if (getWorkspaceRole() === "judge" && PAYPAL_BASE !== "https://api-m.sandbox.paypal.com") return res.status(403).json({ error: "Judge Demo checkout is restricted to PayPal Sandbox." });
    const { orderId } = req.body;
    if (!orderId || typeof orderId !== "string") {
      return res.status(400).json({ error: "A valid PayPal order ID is required." });
    }

    // Only capture orders that this server previously created for a known invoice.
    const invoice = invoices.find(item => item.paypalOrderId === orderId);
    if (!invoice) return res.status(404).json({ error: "This PayPal order is not linked to a known invoice." });
    if (invoice.status === "PAID") {
      return res.json({ status: "COMPLETED", invoiceId: invoice.id, alreadyPaid: true });
    }

    const token = await getPayPalAccessToken();
    const response = await fetch(PAYPAL_BASE + "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || "Payment capture failed." });
    }

    const purchaseUnit = data.purchase_units?.[0];
    const capture = purchaseUnit?.payments?.captures?.[0];
    const capturedAmount = capture?.amount;

    // Mark the invoice paid only when PayPal confirms the exact invoice, amount and currency.
    const matchesInvoice =
      purchaseUnit?.reference_id === invoice.id &&
      capturedAmount?.currency_code === invoice.currency &&
      capturedAmount?.value === invoice.amount;

    if (data.status !== "COMPLETED" || capture?.status !== "COMPLETED" || !matchesInvoice) {
      console.error("PayPal capture did not match invoice:", invoice.id, "order:", orderId);
      return res.status(409).json({
        error: "PayPal has not confirmed a completed capture matching this invoice. The invoice was not marked as paid.",
        status: data.status || "UNKNOWN"
      });
    }

    invoice.status = "PAID";
    await persistInvoice(invoice);
    await recordPaymentEvent(invoice, orderId, capture);
    res.json({ status: "COMPLETED", invoiceId: invoice.id, amount: capturedAmount.value, currency: capturedAmount.currency_code });
  } catch (error) {
    console.error("PayPal capture error:", error.message);
    res.status(500).json({ error: "Unable to verify the PayPal payment. Please check the invoice before retrying." });
  }
});


app.post("/api/recovery/draft", async (req, res) => {
  const invoiceId = String(req.body.invoiceId || "").trim();
  const invoice = invoices.find(item => item.id === invoiceId);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  if (invoice.status === "PAID") return res.status(400).json({ error: "This invoice is already paid." });
  const today = new Date().toISOString().slice(0, 10);
  const daysOverdue = Math.max(0, Math.floor((Date.parse(today + "T00:00:00Z") - Date.parse(invoice.dueDate + "T00:00:00Z")) / 86400000));
  const daysUntilDue = Math.ceil((Date.parse(invoice.dueDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  const priority = daysOverdue > 0 || invoice.status === "OVERDUE" ? "HIGH" : daysUntilDue <= 3 ? "MEDIUM" : "LOW";
  const question = [
    "Write a professional, polite and concise customer-ready payment reminder email for this invoice.",
    "Return only the email content with the exact labels Subject: and Message:. Do not include the word Draft in the subject or message, and do not add internal notes or explanations.",
    "Address the customer by company name. State the exact invoice ID, amount, currency and due date.",
    "Ask the customer to confirm the expected payment date. Do not threaten, add fees, invent facts, or claim payment was sent or received.",
    "The merchant will review and edit the email before sending it. Never claim that the email has already been sent."
  ].join(" ");
  const context = JSON.stringify({ today, invoice });
  try {
    let draft, provider;
    if (process.env.GROQ_API_KEY) {
      try { draft = await askGroq(question, context); provider = "Groq"; }
      catch (groqError) {
        if (groqError.status === 401 || !process.env.GEMINI_API_KEY) throw groqError;
        draft = await askGemini(question, context); provider = "Gemini (fallback)";
      }
    } else if (process.env.GEMINI_API_KEY) {
      draft = await askGemini(question, context); provider = "Gemini";
    } else return res.status(503).json({ error: "AI is not configured." });
    if (!invoice.paymentToken) {
      invoice.paymentToken = crypto.randomBytes(32).toString("hex");
      await persistInvoice(invoice);
    }
    const paymentUrl = "https://smartpay-ai-upps.onrender.com/pay/" + encodeURIComponent(invoice.paymentToken);
    const draftWithPaymentLink = draft + "\n\nView invoice and pay securely: " + paymentUrl;
    return res.json({ invoiceId: invoice.id, customer: invoice.customer, email: invoice.email, amount: invoice.amount, currency: invoice.currency, dueDate: invoice.dueDate, priority, daysOverdue, draft: draftWithPaymentLink, provider, paymentUrl, sent: false });
  } catch (error) {
    console.error("Recovery draft failed:", error.message);
    return res.status(error.status && error.status >= 400 && error.status < 500 ? error.status : 503).json({ error: error.message || "Unable to generate a reminder draft. Please try again." });

  }
});

app.post("/api/recovery/send-email", async (req, res) => {
  const invoiceId = String(req.body.invoiceId || "").trim();
  const subject = String(req.body.subject || "").trim().slice(0, 200);
  const message = String(req.body.message || "").trim().slice(0, 12000);
  const invoice = invoices.find(item => item.id === invoiceId);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  if (invoice.status === "PAID") return res.status(400).json({ error: "This invoice is already paid; no reminder was sent." });
  if (!subject || !message) return res.status(400).json({ error: "Enter an email subject and message." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(invoice.email || ""))) {
    return res.status(400).json({ error: "This invoice does not have a valid customer email address." });
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return res.status(503).json({ error: "Email sending is not configured yet. Add RESEND_API_KEY and RESEND_FROM_EMAIL in the server environment." });
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        to: [invoice.email],
        ...(invoice.merchantProfile?.email ? { reply_to: invoice.merchantProfile.email } : {}),
        subject,
        text: message
      }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) {
      console.error("Transactional email provider rejected a send request:", response.status, result.message || result.name || "Unknown provider error");
      return res.status(502).json({ error: "The email provider could not accept this message. Check the sending domain and provider configuration." });
    }
    console.log("Recovery email accepted by provider for invoice " + invoice.id + "; message id " + result.id);
    return res.json({ sent: true, messageId: result.id, recipient: invoice.email });
  } catch (error) {
    console.error("Recovery email send failed:", error.message);
    return res.status(502).json({ error: "The email could not be sent. Please retry after checking the email provider connection." });
  }
});

app.post("/api/ai/ask", async (req, res) => {
  const question = String(req.body.question || "").trim().slice(0, 1000);
  if (!question) return res.status(400).json({ error: "Please enter a question." });
  const today = new Date().toISOString().slice(0, 10);
  const todayTime = Date.parse(today + "T00:00:00Z");
  const aiInvoices = invoices.map(invoice => {
    const dueDate = String(invoice.dueDate || "").trim();
    const dueDateValid = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) &&
      !Number.isNaN(Date.parse(dueDate + "T00:00:00Z")) &&
      new Date(dueDate + "T00:00:00Z").toISOString().slice(0, 10) === dueDate;
    const dueTime = dueDateValid ? Date.parse(dueDate + "T00:00:00Z") : NaN;
    const dayDifference = dueDateValid ? Math.round((dueTime - todayTime) / 86400000) : null;
    const daysPastDue = dayDifference !== null ? Math.max(0, -dayDifference) : null;
    const daysUntilDue = dayDifference !== null ? Math.max(0, dayDifference) : null;
    const collectionWindow = !dueDateValid ? "DATE_REVIEW_REQUIRED"
      : dayDifference < 0 || invoice.status === "OVERDUE" ? "OVERDUE"
      : dayDifference <= 7 ? "DUE_WITHIN_7_DAYS" : "UPCOMING";
    return {
      id: invoice.id,
      customer: invoice.customer,
      amount: invoice.amount,
      currency: invoice.currency || "USD",
      status: invoice.status,
      customerEmailAvailable: Boolean(String(invoice.email || "").trim()),
      dueDate: dueDateValid ? dueDate : null,
      dueDateValid,
      daysPastDue,
      daysUntilDue,
      collectionWindow,
      lineItems: Array.isArray(invoice.lineItems) ? invoice.lineItems : [],
      paymentLinkAvailable: invoice.status !== "PAID" && Boolean(invoice.paymentToken)
    };
  });
  const context = JSON.stringify({ today, invoices: aiInvoices });

  try {
    if (process.env.GROQ_API_KEY) {
      try {
        const answer = await askGroq(question, context);
        return res.json({ answer, provider: "Groq" });
      } catch (groqError) {
        if (groqError.status === 401) throw groqError;
        if (!process.env.GEMINI_API_KEY) throw groqError;
        console.warn("Groq unavailable; attempting Gemini fallback:", groqError.message);
        const answer = await askGemini(question, context);
        return res.json({ answer, provider: "Gemini (fallback)" });
      }
    }
    if (process.env.GEMINI_API_KEY) {
      const answer = await askGemini(question, context);
      return res.json({ answer, provider: "Gemini" });
    }
    return res.status(503).json({ error: "AI is not configured. Add GROQ_API_KEY or GEMINI_API_KEY in the server environment.", summary: buildBusinessSummary() });
  } catch (error) {
    console.error("AI request failed:", error.message);
    return res.status(error.status && error.status >= 400 && error.status < 500 ? error.status : 503)
      .json({ error: error.message || "AI is temporarily unavailable. Please try again." });
  }
});

function buildBusinessSummary() {
  const total = invoices.reduce((sum, item) => sum + Number(item.amount), 0);
  const overdue = invoices.filter(item => item.status === "OVERDUE");
  const unpaid = invoices.filter(item => item.status === "UNPAID");
  return {
    invoiceCount: invoices.length,
    totalValue: total.toFixed(2),
    paidCount: invoices.filter(item => item.status === "PAID").length,
    unpaidCount: unpaid.length,
    overdueCount: overdue.length,
    overdueInvoices: overdue.map(item => ({ id: item.id, customer: item.customer, amount: item.amount, dueDate: item.dueDate }))
  };
}

app.get("/api/summary", (_req, res) => res.json(buildBusinessSummary()));

app.get("/pay/:token", (_req, res) => res.sendFile(path.join(__dirname, "public", "pay.html")));
app.get("/", (req, res) => {
  if (!getSessionFromRequest(req)) return res.redirect("/login");
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("*", (req, res) => {
  if (req.path === "/index.html") return res.redirect("/");
  return res.status(404).send("Not found");
});

initializeDatabase()
  .then(() => app.listen(PORT, () => console.log("SmartPay AI running on port " + PORT)))
  .catch(error => {
    console.error("Database initialization failed:", error.message);
    process.exit(1);
  });
