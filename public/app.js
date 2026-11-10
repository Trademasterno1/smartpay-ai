const $ = (selector) => document.querySelector(selector);
let invoices = [];

function money(amount, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function renderInvoices() {
  $("#invoiceRows").innerHTML = invoices.map(invoice => `
    <tr>
      <td><strong>${invoice.id}</strong><small>${invoice.customer}</small></td>
      <td>${invoice.dueDate}</td>
      <td class="amount">${money(invoice.amount, invoice.currency)}</td>
      <td><span class="status ${invoice.status}">${invoice.status}</span></td>
      <td>${invoice.status === "PAID" ? "—" : `<button class="pay-button" data-invoice="${invoice.id}">Pay with PayPal</button>`}</td>
    </tr>`).join("");
  $("#invoiceRows").querySelectorAll("[data-invoice]").forEach(button => {
    button.addEventListener("click", () => startPayPalCheckout(button.dataset.invoice));
  });
}

async function refreshDashboard() {
  const [invoiceResponse, summaryResponse] = await Promise.all([
    fetch("/api/invoices"), fetch("/api/summary")
  ]);
  invoices = await invoiceResponse.json();
  const summary = await summaryResponse.json();
  $("#totalValue").textContent = money(summary.totalValue, "USD");
  $("#paidCount").textContent = summary.paidCount;
  $("#unpaidCount").textContent = summary.unpaidCount;
  $("#overdueCount").textContent = summary.overdueCount;
  renderInvoices();
  renderRecoveryInvoices();
}

function renderRecoveryInvoices() {
  const container = $("#recoveryList");
  container.innerHTML = "";
  const outstanding = invoices.filter(invoice => invoice.status !== "PAID");
  if (!outstanding.length) {
    const empty = document.createElement("p");
    empty.className = "recovery-empty";
    empty.textContent = "All sample invoices are paid. No recovery actions are needed.";
    container.appendChild(empty);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  outstanding.sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  outstanding.forEach(invoice => {
    const daysLate = Math.max(0, Math.floor((Date.parse(today + "T00:00:00Z") - Date.parse(invoice.dueDate + "T00:00:00Z")) / 86400000));
    const priority = daysLate > 0 || invoice.status === "OVERDUE" ? "HIGH" : (Date.parse(invoice.dueDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000 <= 3 ? "MEDIUM" : "LOW";
    const card = document.createElement("article");
    card.className = "recovery-item";
    const details = document.createElement("div");
    details.className = "recovery-details";
    const name = document.createElement("strong");
    name.textContent = invoice.customer + " · " + invoice.id;
    const meta = document.createElement("span");
    meta.textContent = money(invoice.amount, invoice.currency) + " · Due " + invoice.dueDate + " · " + invoice.email;
    details.append(name, meta);
    const actions = document.createElement("div");
    actions.className = "recovery-actions";
    const badge = document.createElement("span");
    badge.className = "priority " + priority;
    badge.textContent = priority + " PRIORITY";
    const button = document.createElement("button");
    button.className = "draft-button";
    button.type = "button";
    button.textContent = "Generate reminder";
    const draft = document.createElement("pre");
    draft.className = "recovery-draft";
    draft.hidden = true;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Generating…";
      draft.hidden = false;
      draft.textContent = "Preparing a personalized draft with the AI provider…";
      try {
        const response = await fetch("/api/recovery/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: invoice.id }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not generate reminder.");
        const paymentLink = document.createElement("a");
        let safeCheckoutUrl;
        try { safeCheckoutUrl = new URL(data.checkoutUrl); } catch (_) { throw new Error("PayPal did not return a valid checkout link."); }
        if (safeCheckoutUrl.protocol !== "https:" || !["paypal.com", "www.paypal.com", "www.sandbox.paypal.com"].includes(safeCheckoutUrl.hostname)) throw new Error("The PayPal checkout link is not trusted.");
        paymentLink.href = safeCheckoutUrl.href;
        paymentLink.target = "_blank";
        paymentLink.rel = "noopener noreferrer";
        paymentLink.textContent = "Open secure PayPal checkout";
        paymentLink.className = "recovery-payment-link";
        const draftText = data.draft.replace(/\\n?\\n?Pay securely with PayPal: https:\\/\\/[^\\s]+/i, "");
        draft.textContent = "To: " + data.email + "\\nInvoice: " + data.invoiceId + " · " + money(data.amount, data.currency) + "\\nPriority: " + data.priority + (data.daysOverdue ? " · " + data.daysOverdue + " days overdue" : "") + "\\n\\n" + draftText + "\\n\\nAI provider: " + data.provider + "\\nDraft only — not sent. Payment requires customer approval.";
        draft.appendChild(document.createElement("br"));
        draft.appendChild(paymentLink);
        button.textContent = "Regenerate draft";
      } catch (error) {
        draft.textContent = error.message;
        button.textContent = "Try again";
      } finally { button.disabled = false; }
    });
    actions.append(badge, button);
    card.append(details, actions, draft);
    container.appendChild(card);
  });
}

async function startPayPalCheckout(invoiceId) {
  const button = document.querySelector(`[data-invoice="${invoiceId}"]`);
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Loading…";
  try {
    if (!window.paypal || !window.paypal.Buttons) throw new Error("PayPal checkout SDK is not ready. Refresh and try again.");
    const response = await fetch("/api/paypal/create-order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId })
    });
    const order = await response.json();
    if (!response.ok) throw new Error(order.error || "Unable to start PayPal checkout.");
    const checkout = $("#paypal-checkout-placeholder");
    checkout.innerHTML = "";
    checkout.scrollIntoView({ behavior: "smooth", block: "center" });
    await window.paypal.Buttons({
      createOrder: () => order.id,
      onApprove: async (data) => {
        const captured = await fetch("/api/paypal/capture-order", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: data.orderID })
        });
        const result = await captured.json();
        if (!captured.ok) throw new Error(result.error || "Payment capture failed.");
        $("#aiResponse").textContent = "PayPal Sandbox payment status: " + result.status + ". Invoice: " + (result.invoiceId || invoiceId) + ".";
        checkout.innerHTML = "<strong>Payment processed. Refreshing invoice status…</strong>";
        await refreshDashboard();
      },
      onCancel: () => { $("#aiResponse").textContent = "Checkout was cancelled. No payment was captured."; },
      onError: error => { $("#aiResponse").textContent = "PayPal checkout error: " + error.message; }
    }).render("#paypal-checkout-placeholder");
  } catch (error) {
    $("#aiResponse").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function loadPayPalSdk() {
  const config = await fetch("/api/config").then(response => response.json());
  if (!config.paypalClientId) return;
  const script = document.createElement("script");
  script.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(config.paypalClientId) + "&currency=USD&intent=capture";
  script.onload = () => console.log("PayPal Sandbox SDK loaded.");
  script.onerror = () => console.error("Could not load PayPal SDK.");
  document.head.appendChild(script);
}

$("#askForm").addEventListener("submit", async event => {
  event.preventDefault();
  const question = $("#question").value.trim();
  if (!question) return;

  const responseBox = $("#aiResponse");
  const submitButton = $('#askForm button[type="submit"]');
  const originalButtonText = submitButton.textContent;
  const controller = new AbortController();
  let waitingMessageTimer;
  const hardTimeout = setTimeout(() => controller.abort(), 45000);

  submitButton.disabled = true;
  submitButton.textContent = "…";
  responseBox.textContent = "Thinking… SmartPay AI is contacting the AI provider.";

  waitingMessageTimer = setTimeout(() => {
    responseBox.textContent = "Still working… the AI provider is taking longer than usual. Please wait a little longer.";
  }, 8000);

  try {
    const response = await fetch("/api/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal: controller.signal
    });
    const data = await response.json();
    if (data.answer) responseBox.textContent = data.answer + (data.provider ? "\\n\\nAI provider: " + data.provider : "");
    else if (data.summary) responseBox.textContent = (data.error || "AI is temporarily unavailable.") + "\\n\\nCurrent invoice snapshot:\\n" + JSON.stringify(data.summary, null, 2);
    else responseBox.textContent = data.error || "The AI assistant could not complete the request. Please try again.";
  } catch (error) {
    if (error.name === "AbortError") {
      responseBox.textContent = "This request took too long and was stopped. Please try again in a moment.";
    } else {
      responseBox.textContent = "Unable to reach the AI assistant. Please check your connection and try again.";
    }
  } finally {
    clearTimeout(hardTimeout);
    clearTimeout(waitingMessageTimer);
    submitButton.disabled = false;
    submitButton.textContent = originalButtonText;
  }
});

document.querySelectorAll(".suggestion").forEach(button => {
  button.addEventListener("click", () => {
    $("#question").value = button.textContent;
    $("#askForm").requestSubmit();
  });
});

refreshDashboard().catch(error => console.error(error));
loadPayPalSdk().catch(error => console.error(error));