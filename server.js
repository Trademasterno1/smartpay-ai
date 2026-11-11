require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5, connectionTimeoutMillis: 10000 })
  : null;
let databaseConnected = false;
let merchantProfile = { businessName: "", address: "", email: "", phone: "", taxNumber: "" };
const PAYPAL_BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

const invoices = [
  { id: "INV-1001", customer: "Northstar Studio", email: "billing@example.com", amount: "249.00", currency: "USD", status: "PAID", dueDate: "2026-11-05", paypalOrderId: "DEMO-ORDER-1001" },
  { id: "INV-1002", customer: "Green Leaf Cafe", email: "accounts@example.com", amount: "580.00", currency: "USD", status: "PAID", dueDate: "2026-11-08", paypalOrderId: null },
  { id: "INV-1003", customer: "Atlas Design Co.", email: "finance@example.com", amount: "125.50", currency: "USD", status: "OVERDUE", dueDate: "2026-10-28", paypalOrderId: null },
  { id: "INV-1004", customer: "BrightPath Learning", email: "office@example.com", amount: "920.00", currency: "USD", status: "UNPAID", dueDate: "2026-11-15", paypalOrderId: null }
];


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
    `SELECT id, customer, email, amount::text, currency, status,
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
  await pool.query(
    `INSERT INTO invoices (id, customer, email, amount, currency, status, due_date, paypal_order_id, payment_token, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (id) DO UPDATE SET customer=EXCLUDED.customer, email=EXCLUDED.email,
       amount=EXCLUDED.amount, currency=EXCLUDED.currency, status=EXCLUDED.status,
       due_date=EXCLUDED.due_date, paypal_order_id=EXCLUDED.paypal_order_id,
       payment_token=COALESCE(invoices.payment_token, EXCLUDED.payment_token), updated_at=NOW()`,
    [invoice.id, invoice.customer, invoice.email, invoice.amount, invoice.currency, invoice.status, invoice.dueDate, invoice.paypalOrderId, invoice.paymentToken || null]
  );
}

async function recordPaymentEvent(invoice, orderId, capture) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO payment_events (invoice_id, paypal_order_id, event_type, amount, currency, details)
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

const SMARTPAY_AI_SYSTEM_INSTRUCTION = "You are SmartPay AI, an accounts-receivable intelligence assistant for the SmartPay AI demonstration workspace. Use only facts in the supplied invoice data and clearly label recommendations. Treat PAID as collected; UNPAID and OVERDUE as outstanding. For collection-risk reviews, account for every outstanding invoice exactly once, exclude PAID invoices, rank overdue first, then due today or within 7 days, then later-due invoices. Use the supplied daysPastDue, daysUntilDue, dueDateValid, and collectionWindow fields as authoritative calculations; do not recalculate dates or call a future-due invoice overdue. Explain each risk level with specific invoice evidence and a practical next action. Use HIGH only for overdue invoices, MEDIUM for invoices due today or within 7 days, and LOW for later-due invoices; if dueDateValid is false, explicitly flag the missing/invalid date and recommend verification rather than pretending a date exists. Consider amount as financial exposure, not as evidence of default. Do not invent payment history, customer behavior, promises, probabilities, or percentages. Never invent URLs, payment dates, customer communications, fees, penalties, contract terms, or merchant policies. For a recommended payment action, use only the exact paymentUrl supplied for that invoice; if unavailable, say so. A PayPal order ID is an internal reference, never a customer payment link. Do not claim a reminder was sent or payment collected. Keep currencies separate and do not sum unlike currencies. For collection-risk reviews, return a concise, complete report with one clearly labeled entry per outstanding invoice, its ID, customer, amount and currency, status, due date, risk, evidence, and next action, followed by the top three merchant actions. If the supplied data is incomplete, state exactly what is missing.";

async function askGroq(question, context) {
  const response = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      temperature: 0.2,
      max_completion_tokens: 1800,
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
        systemInstruction: { parts: [{ text: "SMARTPAY_AI_SYSTEM_INSTRUCTION" }] },
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

app.get("/api/merchant-profile", (_req, res) => res.json(merchantProfile));

app.put("/api/merchant-profile", async (req, res) => {
  try {
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
       invoice_totals AS (
         SELECT date_trunc('month', created_at) AS month_start,
                SUM(amount)::numeric(14,2)::text AS amount, COUNT(*)::int AS invoice_count
         FROM invoices
         GROUP BY 1
       ),
       payment_totals AS (
         SELECT date_trunc('month', created_at) AS month_start,
                SUM(amount)::numeric(14,2)::text AS amount, COUNT(*)::int AS payment_count
         FROM payment_events
         WHERE event_type = 'PAYMENT_CAPTURED'
         GROUP BY 1
       )
       SELECT to_char(months.month_start, 'Mon YY') AS label,
              COALESCE(invoice_totals.amount, '0.00') AS "invoicedAmount",
              COALESCE(payment_totals.amount, '0.00') AS "collectedAmount",
              COALESCE(invoice_totals.invoice_count, 0) AS "invoiceCount",
              COALESCE(payment_totals.payment_count, 0) AS "paymentCount"
       FROM months
       LEFT JOIN invoice_totals USING (month_start)
       LEFT JOIN payment_totals USING (month_start)
       ORDER BY months.month_start`,
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
       FROM payment_events pe
       JOIN invoices i ON i.id = pe.invoice_id
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
    if (!merchantProfile.businessName) return res.status(400).json({ error: "Save the merchant details before issuing an invoice." });
    const customer = String(req.body.customer || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const dueDate = String(req.body.dueDate || "").trim();
    const validatedItems = validateInvoiceLineItems(req.body.lineItems);
    if (validatedItems.error) return res.status(400).json({ error: validatedItems.error });
    const amount = Number(validatedItems.amount);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && !Number.isNaN(Date.parse(dueDate + "T00:00:00Z")) && new Date(dueDate + "T00:00:00Z").toISOString().slice(0, 10) === dueDate;
    if (!customer || customer.length > 120) return res.status(400).json({ error: "Enter a customer name (maximum 120 characters)." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid customer email address." });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) return res.status(400).json({ error: "The invoice total exceeds the supported amount." });
    if (!validDate) return res.status(400).json({ error: "Choose a valid due date." });
    const invoice = {
      id: "INV-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
      customer, email, amount: amount.toFixed(2), lineItems: validatedItems.items, merchantProfile: { ...merchantProfile }, currency: "USD", status: "UNPAID", dueDate, paypalOrderId: null,
      paymentToken: crypto.randomBytes(32).toString("hex")
    };
    await pool.query(
      "INSERT INTO invoices (id, customer, email, amount, currency, status, due_date, paypal_order_id, line_items, merchant_profile, payment_token) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)",
      [invoice.id, invoice.customer, invoice.email, invoice.amount, invoice.currency, invoice.status, invoice.dueDate, null, JSON.stringify(invoice.lineItems), JSON.stringify(invoice.merchantProfile), invoice.paymentToken]
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
    const amount = Number(validatedItems.amount);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && !Number.isNaN(Date.parse(dueDate + "T00:00:00Z")) && new Date(dueDate + "T00:00:00Z").toISOString().slice(0, 10) === dueDate;
    if (!customer || customer.length > 120) return res.status(400).json({ error: "Enter a customer name (maximum 120 characters)." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid customer email address." });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) return res.status(400).json({ error: "The invoice total exceeds the supported amount." });
    if (!validDate) return res.status(400).json({ error: "Choose a valid due date." });
    const updated = await pool.query(
      `UPDATE invoices SET customer=$2, email=$3, amount=$4, due_date=$5, line_items=$6::jsonb, updated_at=NOW()
       WHERE id=$1 AND status <> 'PAID' AND paypal_order_id IS NULL
       RETURNING id, customer, email, amount::text, currency, status,
                 to_char(due_date, 'YYYY-MM-DD') AS "dueDate", paypal_order_id AS "paypalOrderId",
                 line_items AS "lineItems"`,
      [invoice.id, customer, email, amount.toFixed(2), dueDate, JSON.stringify(validatedItems.items)]
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


app.get("/api/public-invoices/:token", (req, res) => {
  const invoice = invoices.find(item => item.paymentToken && item.paymentToken === req.params.token);
  if (!invoice) return res.status(404).json({ error: "This invoice link is invalid or has expired." });
  return res.json({
    id: invoice.id, customer: invoice.customer, amount: invoice.amount, currency: invoice.currency,
    status: invoice.status, dueDate: invoice.dueDate, lineItems: invoice.lineItems || [],
    merchantProfile: invoice.merchantProfile || {}
  });
});

app.post("/api/public-invoices/:token/create-order", async (req, res) => {
  try {
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
    const paymentUrl = "/pay/" + encodeURIComponent(invoice.paymentToken);
    const draftWithPaymentLink = draft + "\n\nView invoice and pay securely: " + paymentUrl;
    return res.json({ invoiceId: invoice.id, customer: invoice.customer, email: invoice.email, amount: invoice.amount, currency: invoice.currency, dueDate: invoice.dueDate, priority, daysOverdue, draft: draftWithPaymentLink, provider, paymentUrl, sent: false });
  } catch (error) {
    console.error("Recovery draft failed:", error.message);
    return res.status(error.status && error.status >= 400 && error.status < 500 ? error.status : 503).json({ error: error.message || "Unable to generate a reminder draft. Please try again." });
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
      dueDate: dueDateValid ? dueDate : null,
      dueDateValid,
      daysPastDue,
      daysUntilDue,
      collectionWindow,
      lineItems: Array.isArray(invoice.lineItems) ? invoice.lineItems : [],
      paymentUrl: invoice.status === "PAID" || !invoice.paymentToken
        ? null
        : req.protocol + "://" + req.get("host") + "/pay/" + encodeURIComponent(invoice.paymentToken)
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
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initializeDatabase()
  .then(() => app.listen(PORT, () => console.log("SmartPay AI running on port " + PORT)))
  .catch(error => {
    console.error("Database initialization failed:", error.message);
    process.exit(1);
  });
