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

function openInvoicePDF(invoiceId) {
  const invoice = invoices.find(item => item.id === invoiceId);
  if (!invoice) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Allow pop-ups for SmartPay AI, then try again.");
    return;
  }
  const generatedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const statusLabel = escapeHTML(invoice.status);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(invoice.id)} — SmartPay AI</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#f4f6fa;color:#17243a;font:14px Arial,sans-serif}.sheet{max-width:760px;margin:0 auto;background:#fff;padding:52px;border:1px solid #e7ebf1}.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #172c4b;padding-bottom:24px}.brand{font-size:25px;font-weight:800;letter-spacing:-1px}.brand span{color:#1769e0}.muted{color:#7e8b9d}.eyebrow{font-size:10px;letter-spacing:1.5px;font-weight:700;color:#8391a4}.invoice-title{text-align:right}.invoice-title h1{margin:8px 0;font-size:30px}.status{display:inline-block;padding:7px 10px;border-radius:5px;background:#edf4ff;color:#1769e0;font-size:11px;font-weight:700}.status.PAID{background:#e8f7ef;color:#13865b}.status.OVERDUE{background:#fff0f0;color:#b44d55}.details{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:34px 0}.details h3{font-size:10px;letter-spacing:1px;color:#8995a5;margin:0 0 10px}.details strong{display:block;font-size:16px;margin-bottom:6px}.details p{margin:4px 0;color:#627187}.line{width:100%;border-collapse:collapse;margin-top:28px}.line th{text-align:left;color:#8290a3;font-size:10px;letter-spacing:.8px;padding:13px 10px;border-bottom:1px solid #e8edf3}.line td{padding:18px 10px;border-bottom:1px solid #e8edf3}.line th:last-child,.line td:last-child{text-align:right}.total{display:flex;justify-content:flex-end;margin-top:18px}.total div{width:260px;display:flex;justify-content:space-between;padding:14px 10px;font-size:17px;font-weight:800;border-bottom:2px solid #172c4b}.note{margin-top:34px;padding:15px;background:#f7f9fc;color:#64748a;font-size:11px;line-height:1.7}.footer{margin-top:34px;padding-top:16px;border-top:1px solid #e8edf3;color:#9aa5b4;font-size:10px;line-height:1.7}.actions{text-align:center;margin:22px auto}.actions button{border:0;border-radius:7px;background:#1769e0;color:#fff;padding:12px 20px;font-weight:700;font-size:13px;cursor:pointer}.print-help{max-width:520px;margin:12px auto;color:#64748a;font-size:12px;line-height:1.6}@media print{body{padding:0;background:#fff}.sheet{max-width:none;border:0;padding:28px}.actions{display:none}}@media(max-width:600px){body{padding:10px}.sheet{padding:24px}.top{flex-direction:column}.invoice-title{text-align:left}.details{gap:16px}}
</style>
</head>
<body>
<main class="sheet">
<div class="top"><div><div class="brand">smartpay<span>.ai</span></div><p class="muted">Payment intelligence workspace</p></div><div class="invoice-title"><div class="eyebrow">INVOICE</div><h1>${escapeHTML(invoice.id)}</h1><span class="status ${statusLabel}">${statusLabel}</span></div></div>
<section class="details"><div><h3>BILL TO</h3><strong>${escapeHTML(invoice.customer)}</strong><p>${escapeHTML(invoice.email)}</p></div><div><h3>INVOICE DETAILS</h3><p>Generated: ${escapeHTML(generatedOn)}</p><p>Due date: <strong>${escapeHTML(invoice.dueDate)}</strong></p></div></section>
<table class="line"><thead><tr><th>DESCRIPTION</th><th>QTY</th><th>AMOUNT</th></tr></thead><tbody><tr><td>Services / goods</td><td>1</td><td>${escapeHTML(money(invoice.amount, invoice.currency))}</td></tr></tbody></table>
<div class="total"><div><span>TOTAL</span><span>${escapeHTML(money(invoice.amount, invoice.currency))}</span></div></div>
<div class="note"><strong>DEMO DOCUMENT — NOT A TAX INVOICE</strong><br>This document was generated from the SmartPay AI demonstration workspace. Payments are restricted to PayPal Sandbox; no real funds are collected through this document.</div>
<div class="footer">SmartPay AI · Generated on ${escapeHTML(generatedOn)}<br>Invoice status reflects the latest status available in the workspace at the time this document was generated.</div>
</main>
<div class="actions"><button id="printInvoiceButton" type="button">Print / Save as PDF</button><p class="print-help">On iPhone or iPad, if the print window does not open, use the browser Share button, choose Print, then pinch out on the preview to save/share the PDF.</p></div>
</body>
</html>`;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  const printButton = printWindow.document.getElementById("printInvoiceButton");
  if (printButton) {
    printButton.addEventListener("click", () => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (error) {
        printButton.textContent = "Use Share → Print to save PDF";
      }
    });
  }
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

async function refreshMonthlyAnalytics() {
  const container = $("#monthlyChart");
  if (!container) return;
  const months = $("#monthlyRange")?.value === "12" ? 12 : 6;
  const rangeLabel = $("#monthlyRange")?.selectedOptions[0]?.textContent || "Last 6 months";
  const rangeTag = document.querySelector(".monthly-performance .tiny-tag");
  if (rangeTag) rangeTag.textContent = rangeLabel.toUpperCase();
  container.dataset.months = String(months);
  try {
    const response = await fetch("/api/analytics/monthly?months=" + months, { cache: "no-store", headers: { "Accept": "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Monthly analytics are unavailable.");
    if (!Array.isArray(data) || !data.length) {
      container.innerHTML = '<p class="chart-empty">No monthly data is available yet.</p>';
      return;
    }
    container.style.gridTemplateColumns = "repeat(" + data.length + ", minmax(0, 1fr))";
    const maxValue = Math.max(1, ...data.flatMap(item => [Number(item.invoicedAmount || 0), Number(item.collectedAmount || 0)]));
    container.innerHTML = data.map(item => {
      const invoiced = Number(item.invoicedAmount || 0);
      const collected = Number(item.collectedAmount || 0);
      const invoiceHeight = invoiced > 0 ? Math.max(3, (invoiced / maxValue) * 100) : 0;
      const collectedHeight = collected > 0 ? Math.max(3, (collected / maxValue) * 100) : 0;
      return `<div class="month-column">
        <div class="month-bars">
          <div class="month-bar-slot"><span class="month-bar invoice-bar" style="height:${invoiceHeight}%" title="Invoices: ${escapeHTML(money(invoiced, "USD"))}"></span></div>
          <div class="month-bar-slot"><span class="month-bar collected-bar" style="height:${collectedHeight}%" title="Captured: ${escapeHTML(money(collected, "USD"))}"></span></div>
        </div>
        <span class="month-label">${escapeHTML(item.label)}</span>
        <span class="month-values">${money(invoiced, "USD")} / ${money(collected, "USD")}</span>
      </div>`;
    }).join("");
  } catch (error) {
    console.error("Monthly analytics loading failed:", error);
    container.innerHTML = '<p class="chart-empty">Monthly chart could not load. Refresh the page to retry.</p>';
  }
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
      <td class="invoice-actions-cell">${invoice.status !== "PAID" && !invoice.paypalOrderId ? `<button class="edit-button" data-edit-invoice="${escapeHTML(invoice.id)}">Edit</button>` : ""}${invoice.status === "PAID" ? "—" : `<button class="pay-button" data-invoice="${escapeHTML(invoice.id)}">Pay with PayPal</button>`}<button class="pdf-button" data-pdf-invoice="${escapeHTML(invoice.id)}">PDF</button></td>
    </tr>`).join("");
  if (!visibleInvoices.length) $("#invoiceRows").innerHTML = '<tr><td colspan="5">No matching invoices.</td></tr>';
  $("#invoiceRows").querySelectorAll("[data-invoice]").forEach(button => {
    button.addEventListener("click", () => startPayPalCheckout(button.dataset.invoice));
  });
  $("#invoiceRows").querySelectorAll("[data-edit-invoice]").forEach(button => {
    button.addEventListener("click", () => startEditInvoice(button.dataset.editInvoice));
  });
  $("#invoiceRows").querySelectorAll("[data-pdf-invoice]").forEach(button => {
    button.addEventListener("click", () => openInvoicePDF(button.dataset.pdfInvoice));
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
    await refreshMonthlyAnalytics();
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
$("#monthlyRange").addEventListener("change", refreshMonthlyAnalytics);

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
