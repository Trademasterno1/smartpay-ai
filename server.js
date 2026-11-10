require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const PAYPAL_BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

const invoices = [
  { id: "INV-1001", customer: "Northstar Studio", email: "billing@example.com", amount: "249.00", currency: "USD", status: "PAID", dueDate: "2026-11-05", paypalOrderId: "DEMO-ORDER-1001" },
  { id: "INV-1002", customer: "Green Leaf Cafe", email: "accounts@example.com", amount: "580.00", currency: "USD", status: "UNPAID", dueDate: "2026-11-08", paypalOrderId: null },
  { id: "INV-1003", customer: "Atlas Design Co.", email: "finance@example.com", amount: "125.50", currency: "USD", status: "OVERDUE", dueDate: "2026-10-28", paypalOrderId: null },
  { id: "INV-1004", customer: "BrightPath Learning", email: "office@example.com", amount: "920.00", currency: "USD", status: "UNPAID", dueDate: "2026-11-15", paypalOrderId: null }
];

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

async function askGroq(question, context) {
  const response = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      temperature: 0.2,
      max_completion_tokens: 700,
      messages: [
        { role: "system", content: "You are SmartPay AI, a careful finance operations assistant for small businesses. Answer using only the invoice data provided. Never claim a payment was received unless its status is PAID. Distinguish demo data from real financial records. Be concise and give actionable insights." },
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
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error("Groq returned an empty response.");
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
        systemInstruction: { parts: [{ text: "You are SmartPay AI, a careful finance operations assistant for small businesses. Answer using only the invoice data provided. Never claim a payment was received unless its status is PAID. Distinguish demo data from real financial records. Be concise and give actionable insights." }] },
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
  const answer = data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("\n");
  if (!answer) throw new Error("Gemini returned an empty response.");
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
  res.json({ ok: true, app: "SmartPay AI", paypalConfigured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) });
});

app.get("/api/invoices", (_req, res) => res.json(invoices));

app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const invoice = invoices.find(item => item.id === req.body.invoiceId);
    if (!invoice) return res.status(404).json({ error: "Invoice not found." });
    if (invoice.status === "PAID") return res.status(400).json({ error: "This invoice is already paid." });
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
        }]
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || "Could not create PayPal order." });
    invoice.paypalOrderId = data.id;
    res.json({ id: data.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.json({ status: "COMPLETED", invoiceId: invoice.id, amount: capturedAmount.value, currency: capturedAmount.currency_code });
  } catch (error) {
    console.error("PayPal capture error:", error.message);
    res.status(500).json({ error: "Unable to verify the PayPal payment. Please check the invoice before retrying." });
  }
});

app.post("/api/ai/ask", async (req, res) => {
  const question = String(req.body.question || "").trim().slice(0, 1000);
  if (!question) return res.status(400).json({ error: "Please enter a question." });
  const context = JSON.stringify(invoices);

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

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log("SmartPay AI running on port " + PORT));
