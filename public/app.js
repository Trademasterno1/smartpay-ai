function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

const $ = (selector) => document.querySelector(selector);
let invoices = [];
let paymentHistory = [];

function money(amount, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function renderFinancialDashboard() {
  const total = invoices.reduce((sum, invoice) => sum + Math.round(Number(invoice.amount || 0) * 100), 0);
  const paidInvoices = invoices.filter(invoice => invoice.status === "PAID");
  const overdueInvoices = invoices.filter(invoice => invoice.status === "OVERDUE");
  const outstandingInvoices = invoices.filter(invoice => invoice.status !== "PAID");
  const paid = paidInvoices.reduce((sum, invoice) => sum + Math.round(Number(invoice.amount || 0) * 100), 0);
  const overdue = overdueInvoices.reduce((sum, invoice) => sum + Math.round(Number(invoice.amount || 0) * 100), 0);
  const outstanding = outstandingInvoices.reduce((sum, invoice) => sum + Math.round(Number(invoice.amount || 0) * 100), 0);
  const rate = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  const currency = invoices[0]?.currency || "USD";

  $("#totalValue").textContent = money(total / 100, currency);
  $("#totalInvoiceNote").textContent = invoices.length + (invoices.length === 1 ? " invoice in the workspace" : " invoices in the workspace");
  $("#paidAmount").textContent = money(paid / 100, currency);
  $("#paidCount").textContent = paidInvoices.length + (paidInvoices.length === 1 ? " paid invoice" : " paid invoices");
  $("#outstandingAmount").textContent = money(outstanding / 100, currency);
  $("#unpaidCount").textContent = outstandingInvoices.length + (outstandingInvoices.length === 1 ? " unpaid invoice" : " unpaid invoices");
  $("#overdueAmount").textContent = money(overdue / 100, currency);
  $("#overdueCount").textContent = overdueInvoices.length + (overdueInvoices.length === 1 ? " overdue invoice" : " overdue invoices");
  $("#collectionRate").textContent = rate.toFixed(1) + "%";
  $("#collectionCaption").textContent = total > 0
    ? money(paid / 100, currency) + " collected from " + money(total / 100, currency) + " invoiced."
    : "Create an invoice to start tracking collections.";
  $("#collectedBar").style.width = rate + "%";
  $("#outstandingBar").style.width = (100 - rate) + "%";
  $("#chartPaidAmount").textContent = money(paid / 100, currency);
  $("#chartOutstandingAmount").textContent = money(outstanding / 100, currency);
  $("#overdueDetail").textContent = "Overdue: " + money(overdue / 100, currency) + " · " + overdueInvoices.length + (overdueInvoices.length === 1 ? " invoice" : " invoices") + ". Included in outstanding.";
}

function renderInvoices() {
  const query = ($("#invoiceSearch")?.value || "").trim().toLowerCase();
  const status = $("#invoiceStatusFilter")?.value || "ALL";
  const visibleInvoices = invoices.filter(invoice => {
    const matchesQuery = [invoice.id, invoice.customer, invoice.email].some(value => String(value || "").toLowerCase().includes(query));
    return matchesQuery && (status === "ALL" || invoice.status === status);
  });
  $("#invoiceRows").innerHTML = visibleInvoices.map(invoice => `
    <tr>
      <td><strong>${escapeHTML(invoice.id)}</strong><small>${escapeHTML(invoice.customer)}</small></td>
      <td>${escapeHTML(invoice.dueDate)}</td>
      <td class="amount">${money(invoice.amount, invoice.currency)}</td>
      <td><span class="status ${escapeHTML(invoice.status)}">${escapeHTML(invoice.status)}</span></td>
      <td class="invoice-actions-cell">${invoice.status !== "PAID" && !invoice.paypalOrderId ? `<button class="edit-button" data-edit-invoice="${escapeHTML(invoice.id)}">Edit</button>` : ""}${invoice.status === "PAID" ? "—" : `<button class="pay-button" data-invoice="${escapeHTML(invoice.id)}">Pay with PayPal</button>`}</td>
    </tr>`).join("");
  if (!visibleInvoices.length) $("#invoiceRows").innerHTML = '<tr><td colspan="5">No matching invoices.</td></tr>';
  $("#invoiceRows").querySelectorAll("[data-invoice]").forEach(button => {
    button.addEventListener("click", () => startPayPalCheckout(button.dataset.invoice));
  });
  $("#invoiceRows").querySelectorAll("[data-edit-invoice]").forEach(button => {
    button.addEventListener("click", () => startEditInvoice(button.dataset.editInvoice));
  });
}


function startEditInvoice(invoiceId) {
  const invoice = invoices.find(item => item.id === invoiceId);
  if (!invoice) return;
  const form = $("#createInvoiceForm");
  form.elements.invoiceId.value = invoice.id;
  form.elements.customer.value = invoice.customer;
  form.elements.email.value = invoice.email;
  form.elements.amount.value = invoice.amount;
  form.elements.dueDate.value = invoice.dueDate;
  $("#createInvoiceButton").textContent = "Save changes";
  $("#cancelEditButton").hidden = false;
  $("#createInvoiceMessage").textContent = "Editing " + invoice.id + ". Paid or PayPal-linked invoices are locked.";
  $("#createInvoiceMessage").className = "";
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function downloadCSV(filename, headers, rows) {
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const csv = [headers, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportInvoicesCSV() {
  downloadCSV('smartpay-invoices.csv',
    ['Invoice ID','Customer','Email','Amount','Currency','Status','Due Date'],
    invoices.map(x => [x.id,x.customer,x.email,x.amount,x.currency,x.status,x.dueDate]));
}

function exportPaymentsCSV() {
  downloadCSV('smartpay-payment-history.csv',
    ['Invoice ID','Customer','Amount','Currency','Result','PayPal Capture ID','PayPal Order ID','Date'],
    paymentHistory.map(x => [x.invoiceId,x.customer,x.amount,x.currency,x.eventType || 'PAYMENT_CAPTURED',x.captureId,x.paypalOrderId,x.createdAt]));
}

async function refreshDashboard() {
  const container = $("#recoveryList");
  if (container) container.innerHTML = '<p class="recovery-empty">Loading outstanding invoices…</p>';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    // Load invoices independently so a summary endpoint issue cannot block recovery actions.
    const invoiceResponse = await fetch("/api/invoices", {
      cache: "no-store",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    if (!invoiceResponse.ok) throw new Error("Invoices API returned HTTP " + invoiceResponse.status);
    const invoiceData = await invoiceResponse.json();
    if (!Array.isArray(invoiceData)) throw new Error("Invoices API returned an unexpected response.");
    invoices = invoiceData;
    renderInvoices();
    renderRecoveryInvoices();
    await refreshPaymentHistory();

    renderFinancialDashboard();
  } catch (error) {
    console.error("Dashboard loading failed:", error);
    if (container) {
      container.innerHTML = "";
      const message = document.createElement("p");
      message.className = "recovery-empty";
      message.textContent = error.name === "AbortError"
        ? "Loading timed out. Please check your connection and retry."
        : "Could not load outstanding invoices. " + (error.message || "Please check your connection.");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "draft-button";
      retry.textContent = "Retry loading";
      retry.addEventListener("click", () => refreshDashboard());
      container.append(message, retry);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshPaymentHistory() {
  const container = $("#paymentHistoryRows");
  if (!container) return;
  try {
    const response = await fetch("/api/payments", { cache: "no-store", headers: { "Accept": "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Payment history is unavailable.");
    paymentHistory = Array.isArray(data) ? data : [];
    if (!paymentHistory.length) {
      container.innerHTML = '<tr><td colspan="5">No captured payments recorded yet.</td></tr>';
      return;
    }
    container.innerHTML = data.map(payment => {
      const date = new Date(payment.createdAt);
      const dateLabel = Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
      return `<tr>
        <td><strong>${escapeHTML(payment.invoiceId)}</strong><small>${escapeHTML(payment.customer)}</small></td>
        <td class="amount">${money(payment.amount, payment.currency)}</td>
        <td><span class="status PAID">CAPTURED</span></td>
        <td><small>${escapeHTML(payment.captureId || payment.paypalOrderId || "—")}</small></td>
        <td><small>${escapeHTML(dateLabel)}</small></td>
      </tr>`;
    }).join("");
  } catch (error) {
    container.innerHTML = '<tr><td colspan="5">Could not load payment history. ' + escapeHTML(error.message) + '</td></tr>';
  }
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
        const paymentMarker = "\\n\\nPay securely with PayPal:";
        const paymentMarkerIndex = data.draft.indexOf(paymentMarker);
        const draftText = paymentMarkerIndex >= 0 ? data.draft.slice(0, paymentMarkerIndex) : data.draft;
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


$("#invoiceSearch").addEventListener("input", renderInvoices);
$("#invoiceStatusFilter").addEventListener("change", renderInvoices);

$("#cancelEditButton").addEventListener("click", () => {
  $("#createInvoiceForm").reset();
  $("#editingInvoiceId").value = "";
  $("#createInvoiceButton").textContent = "Create invoice";
  $("#cancelEditButton").hidden = true;
  $("#createInvoiceMessage").textContent = "New invoices are saved to Neon as UNPAID. No payment is taken.";
  $("#createInvoiceMessage").className = "";
});

$("#createInvoiceForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#createInvoiceButton");
  const message = $("#createInvoiceMessage");
  const originalText = button.textContent;
  const formData = new FormData(form);
  const invoiceId = String(formData.get("invoiceId") || "");
  const payload = { customer: formData.get("customer"), email: formData.get("email"), amount: formData.get("amount"), dueDate: formData.get("dueDate") };
  button.disabled = true;
  button.textContent = "Saving…";
  message.textContent = invoiceId ? "Updating invoice in Neon…" : "Saving invoice to Neon…";
  message.className = "";
  try {
    const response = await fetch(invoiceId ? "/api/invoices/" + encodeURIComponent(invoiceId) : "/api/invoices", {
      method: invoiceId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save invoice.");
    form.reset();
    $("#editingInvoiceId").value = "";
    $("#createInvoiceButton").textContent = "Create invoice";
    $("#cancelEditButton").hidden = true;
    await refreshDashboard();
    message.textContent = invoiceId ? data.invoice.id + " updated and saved." : data.invoice.id + " created and saved as UNPAID.";
    message.className = "success-message";
  } catch (error) {
    message.textContent = error.message || "Could not save invoice. Please try again.";
    message.className = "error-message";
  } finally {
    button.disabled = false;
    if (!invoiceId) button.textContent = originalText;
  }
});

refreshDashboard().catch(error => console.error(error));
loadPayPalSdk().catch(error => console.error(error));
$('#exportInvoicesButton').addEventListener('click', exportInvoicesCSV);
$('#exportPaymentsButton').addEventListener('click', exportPaymentsCSV);
