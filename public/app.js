function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

function renderRiskReview(container, raw, provider) {
  const source = String(raw || "");
  const styleId = "smartpay-risk-review-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = ".risk-review{display:grid;gap:12px;margin-top:14px;min-width:0;width:100%;max-width:100%;box-sizing:border-box}.risk-review-intro{color:#64748b;line-height:1.6;font-size:13px;margin:0;overflow-wrap:anywhere}.risk-invoice-card{background:#fff;border:1px solid #e5eaf1;border-radius:13px;padding:15px;box-shadow:0 5px 18px rgba(23,36,58,.045);min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden}.risk-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px;min-width:0}.risk-card-title{font-size:14px;font-weight:800;color:#17243a;overflow-wrap:anywhere;min-width:0;flex:1}.risk-level{font-size:10px;font-weight:800;letter-spacing:.5px;padding:6px 8px;border-radius:20px;white-space:nowrap;flex:0 0 auto}.risk-level.HIGH{background:#fff0f0;color:#b6424a}.risk-level.MEDIUM{background:#fff7e7;color:#9b6800}.risk-level.LOW{background:#eaf7f0;color:#168257}.risk-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0 0 12px}.risk-fact{background:#f7f9fc;border-radius:9px;padding:9px;min-width:0;overflow:hidden}.risk-fact span{display:block;color:#8290a3;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}.risk-fact strong{display:block;font-size:12px;line-height:1.45;overflow-wrap:anywhere;word-break:break-word}.risk-copy{font-size:12px;line-height:1.6;color:#42516a;margin:9px 0 0;overflow-wrap:anywhere;word-break:break-word}.risk-copy b{display:block;color:#17243a;font-size:10px;letter-spacing:.6px;text-transform:uppercase;margin-bottom:4px}.risk-action{background:#f2f7ff;border-left:3px solid #1769e0;border-radius:7px;padding:11px;margin-top:11px;color:#243b5a;font-size:12px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word}.risk-action b{display:block;font-size:10px;letter-spacing:.6px;margin-bottom:4px}.risk-action a{display:block;margin-top:7px;color:#1769e0;font-weight:700;overflow-wrap:anywhere;word-break:break-all}.risk-top-actions{background:#fff;border:1px solid #e5eaf1;border-radius:13px;padding:14px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden}.risk-top-actions h4{margin:0 0 9px;font-size:12px}.risk-top-actions ol{margin:0;padding-left:19px;color:#42516a;font-size:12px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word}.risk-top-actions li+li{margin-top:8px}.risk-provider{color:#8290a3;font-size:10px;margin-top:3px;overflow-wrap:anywhere}@media(max-width:520px){.risk-facts{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.risk-card-head{align-items:flex-start}.risk-invoice-card,.risk-top-actions{padding:12px}.risk-card-title{font-size:13px}.risk-copy,.risk-action,.risk-top-actions ol{font-size:11px}.forecast-ai-review,.forecast-ai-result{min-width:0;max-width:100%;width:100%;box-sizing:border-box;overflow:hidden}.forecast-ai-review strong{font-size:13px;line-height:1.4;overflow-wrap:anywhere}.forecast-ai-review p{font-size:11px;line-height:1.55;overflow-wrap:anywhere}.forecast-ai-review button{max-width:100%;white-space:normal;line-height:1.35}}";
    document.head.appendChild(style);
  }
  container.replaceChildren();
  const wrapper = document.createElement("div");
  wrapper.className = "risk-review";
  const notice = document.createElement("div");
  notice.className = "ai-action-disclaimer";
  notice.textContent = "AI recommendations only · No reminders or messages have been scheduled or sent, and no calls or payments have been made.";
  wrapper.appendChild(notice);
  const fields = ["INVOICE", "CUSTOMER", "AMOUNT", "STATUS", "DUE DATE", "TIMING", "RISK", "EVIDENCE", "NEXT ACTION"];
  const fieldPattern = fields.map(name => name.replace(/\s+/g, "\\s+")).join("|");
  const sections = source.split(/(?=INVOICE\s*:)/i).slice(1);
  const topActionMatch = source.match(/Prioritized\s+Merchant\s+Actions\s*([\s\S]*?)(?=INVOICE\s*:|$)/i);
  let priorityText = topActionMatch ? topActionMatch[1] : "";
  if (!priorityText) {
    const laterMatch = source.match(/---\s*Prioritized\s+Merchant\s+Actions\s*---?\s*([\s\S]*)$/i);
    if (laterMatch) priorityText = laterMatch[1];
  }
  const cleanPriority = priorityText.replace(/^\s*[-—:]+\s*/, "").trim();
  let priorityItems = [...cleanPriority.matchAll(/(?:^|\s)([1-3])\.\s+([\s\S]*?)(?=\s+[1-3]\.\s+|$)/g)];
  if (!priorityItems.length && cleanPriority) {
    const paragraphs = cleanPriority.split(/\n\s*\n|(?=Within the next |Add a calendar )/i).map(item => item.trim()).filter(Boolean);
    priorityItems = paragraphs.map((item, index) => [item, String(index + 1), item]);
  }
  if (priorityItems.length) {
    const section = document.createElement("section");
    section.className = "risk-top-actions";
    const heading = document.createElement("h4");
    heading.textContent = "Prioritized merchant actions";
    const list = document.createElement("ol");
    priorityItems.forEach(match => {
      const item = document.createElement("li");
      item.textContent = match[2].trim();
      list.appendChild(item);
    });
    section.append(heading, list);
    wrapper.appendChild(section);
  }
  let rendered = 0;
  sections.forEach(sectionText => {
    sectionText = sectionText.split(/---\s*Prioritized\s+Merchant\s+Actions/i)[0];
    const values = {};
    fields.forEach((field, index) => {
      const nextFields = fields.slice(index + 1).map(name => name.replace(/\s+/g, "\\s+")).join("|");
      const lookahead = nextFields ? "(?=;\\s*(?:" + nextFields + ")\\s*:|$)" : "$";
      const pattern = new RegExp("(?:^|;)\\s*" + field.replace(/\s+/g, "\\s+") + "\\s*:\\s*([\\s\\S]*?)" + lookahead, "i");
      const match = sectionText.match(pattern);
      if (match) values[field] = match[1].trim().replace(/[;\\s]+$/, "");
    });
    const invoiceId = values.INVOICE || "";
    if (!/^[A-Z0-9][A-Z0-9_-]*\d/i.test(invoiceId)) return;
    const card = document.createElement("article");
    card.className = "risk-invoice-card";
    const head = document.createElement("div");
    head.className = "risk-card-head";
    const title = document.createElement("div");
    title.className = "risk-card-title";
    title.textContent = invoiceId + " · " + (values.CUSTOMER || "Customer not recorded");
    const riskValue = (values.RISK || "UNRATED").toUpperCase();
    const risk = document.createElement("span");
    risk.className = "risk-level " + (["HIGH", "MEDIUM", "LOW"].includes(riskValue) ? riskValue : "LOW");
    risk.textContent = riskValue + (riskValue === "UNRATED" ? "" : " RISK");
    head.append(title, risk);
    const facts = document.createElement("div");
    facts.className = "risk-facts";
    [["Amount", values.AMOUNT], ["Status", values.STATUS], ["Due date", values["DUE DATE"]], ["Timing", values.TIMING]].forEach(([label, value]) => {
      const fact = document.createElement("div");
      fact.className = "risk-fact";
      const caption = document.createElement("span");
      caption.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value || "Not recorded";
      fact.append(caption, strong);
      facts.appendChild(fact);
    });
    const evidence = document.createElement("p");
    evidence.className = "risk-copy";
    const evidenceLabel = document.createElement("b");
    evidenceLabel.textContent = "Evidence for risk";
    evidence.append(evidenceLabel, document.createTextNode(values.EVIDENCE || "No evidence supplied."));
    const action = document.createElement("div");
    action.className = "risk-action";
    const actionLabel = document.createElement("b");
    actionLabel.textContent = "Next practical action";
    const nextAction = values["NEXT ACTION"] || "Review this invoice.";
    action.append(actionLabel, document.createTextNode(nextAction.replace(/https?:\/\/\S+/gi, "").trim()));
    card.append(head, facts, evidence, action);
    const actionControls = createInvoiceActionControls(invoiceId);
    if (actionControls) card.appendChild(actionControls);
    wrapper.appendChild(card);
    rendered += 1;
  });
  if (!rendered) {
    const fallback = document.createElement("p");
    fallback.className = "risk-review-intro";
    fallback.textContent = "The AI response could not be formatted into invoice cards. Please run the analysis again.";
    wrapper.appendChild(fallback);
  }
  const footer = document.createElement("div");
  footer.className = "risk-provider";
  footer.textContent = "AI provider: " + (provider || "Not reported");
  wrapper.appendChild(footer);
  container.appendChild(wrapper);
}

function renderRiskFallback(container, ranked, provider, missingInvoiceIds = []) {
  const styleId = "smartpay-risk-review-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = ".risk-review{display:grid;gap:14px;margin-top:16px}.risk-review-intro{color:#64748b;line-height:1.65}.risk-invoice-card{background:#fff;border:1px solid #e5eaf1;border-radius:14px;padding:18px;box-shadow:0 5px 18px rgba(23,36,58,.045)}.risk-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}.risk-card-title{font-size:15px;font-weight:800;color:#17243a;overflow-wrap:anywhere}.risk-level{font-size:10px;font-weight:800;letter-spacing:.6px;padding:6px 9px;border-radius:20px;white-space:nowrap}.risk-level.HIGH{background:#fff0f0;color:#b6424a}.risk-level.MEDIUM{background:#fff7e7;color:#9b6800}.risk-level.LOW{background:#eaf7f0;color:#168257}.risk-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 14px}.risk-fact{background:#f7f9fc;border-radius:9px;padding:10px;min-width:0}.risk-fact span{display:block;color:#8290a3;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px}.risk-fact strong{font-size:13px;overflow-wrap:anywhere}.risk-copy{font-size:13px;line-height:1.65;color:#42516a;margin:10px 0 0}.risk-copy b{display:block;color:#17243a;font-size:10px;letter-spacing:.7px;text-transform:uppercase;margin-bottom:4px}.risk-action{background:#f2f7ff;border-left:3px solid #1769e0;border-radius:7px;padding:12px;margin-top:12px;color:#243b5a;font-size:13px;line-height:1.65}.risk-action b{display:block;font-size:10px;letter-spacing:.7px;margin-bottom:4px}.risk-top-actions{background:#fff;border:1px solid #e5eaf1;border-radius:14px;padding:16px}.risk-top-actions h4{margin:0 0 10px;font-size:13px}.risk-top-actions ol{margin:0;padding-left:20px;color:#42516a;font-size:13px;line-height:1.7}.risk-provider{color:#8290a3;font-size:11px;margin-top:4px}@media(max-width:520px){.risk-facts{grid-template-columns:1fr}.risk-card-head{align-items:center}}";
    document.head.appendChild(style);
  }
  container.replaceChildren();
  const wrapper = document.createElement("div");
  wrapper.className = "risk-review";
  const intro = document.createElement("p");
  intro.className = "risk-review-intro";
  intro.textContent = "AI returned an incomplete review. This rules-based assessment uses invoice status and due dates; it is not an AI prediction. No reminders or messages were sent, no calls were made, and no payments were taken.";
  wrapper.appendChild(intro);
  ranked.forEach((item, index) => {
    const invoice = item.invoice;
    const card = document.createElement("article");
    card.className = "risk-invoice-card";
    const head = document.createElement("div");
    head.className = "risk-card-head";
    const title = document.createElement("div");
    title.className = "risk-card-title";
    title.textContent = (index + 1) + ". " + invoice.id + " · " + (invoice.customer || "Customer not recorded");
    const risk = document.createElement("span");
    risk.className = "risk-level " + item.risk;
    risk.textContent = item.risk + " RISK";
    head.append(title, risk);
    const facts = document.createElement("div");
    facts.className = "risk-facts";
    [["Amount", money(item.amount, invoice.currency || "USD")], ["Status", invoice.status], ["Due date", invoice.dueDate || "Not recorded"], ["Timing", item.daysPastDue > 0 ? item.daysPastDue + " day(s) past due" : item.daysUntilDue !== null ? item.daysUntilDue + " day(s) until due" : "Date needs review"]].forEach(([label, value]) => {
      const fact = document.createElement("div"); fact.className = "risk-fact";
      const caption = document.createElement("span"); caption.textContent = label;
      const strong = document.createElement("strong"); strong.textContent = value;
      fact.append(caption, strong); facts.appendChild(fact);
    });
    const evidence = document.createElement("p");
    evidence.className = "risk-copy";
    const evidenceLabel = document.createElement("b");
    evidenceLabel.textContent = "Evidence for risk";
    evidence.append(evidenceLabel, document.createTextNode(item.evidence));
    const action = document.createElement("div");
    action.className = "risk-action";
    const actionLabel = document.createElement("b");
    actionLabel.textContent = "Next practical action";
    action.append(actionLabel, document.createTextNode(item.action));
    card.append(head, facts, evidence, action);
    wrapper.appendChild(card);
  });
  if (ranked.length) {
    const section = document.createElement("section");
    section.className = "risk-top-actions";
    const heading = document.createElement("h4");
    heading.textContent = "Top priorities for the merchant";
    const list = document.createElement("ol");
    ranked.slice(0, 3).forEach(item => {
      const li = document.createElement("li");
      li.textContent = item.invoice.id + " — " + item.action;
      list.appendChild(li);
    });
    section.append(heading, list);
    wrapper.appendChild(section);
  } else {
    const empty = document.createElement("p");
    empty.className = "risk-review-intro";
    empty.textContent = "No outstanding invoices were found.";
    wrapper.appendChild(empty);
  }
  const footer = document.createElement("div");
  footer.className = "risk-provider";
  footer.textContent = "Assessment: rules-based fallback" + (provider ? " · AI provider attempted: " + provider : "");
  wrapper.appendChild(footer);
  container.appendChild(wrapper);
}


const $ = (selector) => document.querySelector(selector);
let invoices = [];
let actionBriefAutoRequested = false;
let paymentHistory = [];
let currentMerchantProfile = { businessName: "", address: "", email: "", phone: "", taxNumber: "" };

function money(amount, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function addInvoiceItemRow(item = {}) {
  const row = document.createElement("div");
  row.className = "invoice-item-row";
  row.innerHTML = `
    <input class="item-description" type="text" maxlength="300" placeholder="Description (e.g. Consulting service)" aria-label="Item description" required>
    <input class="item-quantity" type="number" min="0.001" max="999999" step="0.001" placeholder="Qty" aria-label="Quantity" required>
    <input class="item-unit-price" type="number" min="0.01" max="99999999.99" step="0.01" placeholder="Unit price" aria-label="Unit price" required>
    <strong class="item-row-total">$0.00</strong>
    <button type="button" class="remove-item-button" aria-label="Remove item">×</button>`;
  row.querySelector(".item-description").value = item.description || "";
  row.querySelector(".item-quantity").value = item.quantity ?? 1;
  row.querySelector(".item-unit-price").value = item.unitPrice ?? "";
  $("#invoiceItemRows").appendChild(row);
  row.querySelectorAll("input").forEach(input => input.addEventListener("input", updateInvoiceItemsTotal));
  row.querySelector(".remove-item-button").addEventListener("click", () => {
    if ($("#invoiceItemRows").children.length > 1) row.remove();
    updateInvoiceItemsTotal();
  });
  updateInvoiceItemsTotal();
}

function collectInvoiceItems() {
  return [...$("#invoiceItemRows").querySelectorAll(".invoice-item-row")].map(row => ({
    description: row.querySelector(".item-description").value.trim(),
    quantity: row.querySelector(".item-quantity").value,
    unitPrice: row.querySelector(".item-unit-price").value
  }));
}

function updateInvoiceItemsTotal() {
  const rows = [...$("#invoiceItemRows").querySelectorAll(".invoice-item-row")];
  let subtotalCents = 0;
  rows.forEach(row => {
    const qty = Number(row.querySelector(".item-quantity").value);
    const price = Number(row.querySelector(".item-unit-price").value);
    const lineCents = Number.isFinite(qty * price) ? Math.round(qty * price * 100) : 0;
    subtotalCents += lineCents;
    row.querySelector(".item-row-total").textContent = money(lineCents / 100, "USD");
  });
  const taxRate = Math.min(100, Math.max(0, Number($("#invoiceTaxRate")?.value || 0)));
  const taxCents = Math.round(subtotalCents * taxRate / 100);
  const totalCents = subtotalCents + taxCents;
  $("#invoiceAmount").value = (totalCents / 100).toFixed(2);
  $("#invoiceItemsTotal").textContent = money(subtotalCents / 100, "USD");
  $("#invoiceTaxAmount").textContent = money(taxCents / 100, "USD");
  $("#invoiceGrandTotal").textContent = money(totalCents / 100, "USD");
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
  const statusLabel = escapeHTML(getInvoiceDisplayStatus(invoice));
  const issuer = invoice.merchantProfile || currentMerchantProfile;
  const issuerName = escapeHTML(issuer.businessName || "Merchant details not set");
  const issuerDetails = [issuer.address, issuer.email, issuer.phone, issuer.taxNumber ? "TRN: " + issuer.taxNumber : ""].filter(Boolean).map(escapeHTML);
  const invoiceSubtotal = (Array.isArray(invoice.lineItems) && invoice.lineItems.length ? invoice.lineItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0) : Number(invoice.amount));
  const invoiceTaxRate = Number(invoice.taxRate || 0);
  const invoiceTaxAmount = Math.max(0, Number(invoice.amount) - invoiceSubtotal);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(invoice.id)} — SmartPay AI</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#f4f6fa;color:#17243a;font:14px Arial,sans-serif}.sheet{max-width:760px;margin:0 auto;background:#fff;padding:52px;border:1px solid #e7ebf1}.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #172c4b;padding-bottom:24px}.brand{font-size:25px;font-weight:800;letter-spacing:-1px}.brand span{color:#1769e0}.muted{color:#7e8b9d}.eyebrow{font-size:10px;letter-spacing:1.5px;font-weight:700;color:#8391a4}.invoice-title{text-align:right}.invoice-title h1{margin:8px 0;font-size:30px}.status{display:inline-block;padding:7px 10px;border-radius:5px;background:#edf4ff;color:#1769e0;font-size:11px;font-weight:700}.status.PAID{background:#e8f7ef;color:#13865b}.status.OVERDUE{background:#fff0f0;color:#b44d55}.details{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:34px 0}.details h3{font-size:10px;letter-spacing:1px;color:#8995a5;margin:0 0 10px}.details strong{display:block;font-size:16px;margin-bottom:6px}.details p{margin:4px 0;color:#627187}.line{width:100%;border-collapse:collapse;margin-top:28px}.line th{text-align:left;color:#8290a3;font-size:10px;letter-spacing:.8px;padding:13px 10px;border-bottom:1px solid #e8edf3}.line td{padding:18px 10px;border-bottom:1px solid #e8edf3}.line th:last-child,.line td:last-child{text-align:right}.totals{display:grid;gap:8px;width:280px;margin:18px 0 0 auto}.totals div{display:flex;justify-content:space-between;gap:16px;padding:5px 10px;color:#627187}.totals .grand-total{padding:12px 10px;font-size:17px;font-weight:800;color:#17243a;border-bottom:2px solid #172c4b}.note{margin-top:34px;padding:15px;background:#f7f9fc;color:#64748a;font-size:11px;line-height:1.7}.footer{margin-top:34px;padding-top:16px;border-top:1px solid #e8edf3;color:#9aa5b4;font-size:10px;line-height:1.7}.actions{text-align:center;margin:22px auto}.actions button{border:0;border-radius:7px;background:#1769e0;color:#fff;padding:12px 20px;font-weight:700;font-size:13px;cursor:pointer}.print-help{max-width:520px;margin:12px auto;color:#64748a;font-size:12px;line-height:1.6}@media print{body{padding:0;background:#fff}.sheet{max-width:none;border:0;padding:28px}.actions{display:none}}@media(max-width:600px){body{padding:10px}.sheet{padding:24px}.top{flex-direction:column}.invoice-title{text-align:left}.details{gap:16px}}
</style>
</head>
<body>
<main class="sheet">
<div class="top"><div><div class="brand">${issuerName}</div>${issuerDetails.map(detail => `<p class="muted">${detail}</p>`).join("")}</div><div class="invoice-title"><div class="eyebrow">INVOICE</div><h1>${escapeHTML(invoice.id)}</h1><span class="status ${statusLabel}">${statusLabel}</span></div></div>
<section class="details"><div><h3>BILL TO</h3><strong>${escapeHTML(invoice.customer)}</strong><p>${escapeHTML(invoice.email)}</p></div><div><h3>INVOICE DETAILS</h3><p>Generated: ${escapeHTML(generatedOn)}</p><p>Due date: <strong>${escapeHTML(invoice.dueDate)}</strong></p></div></section>
<table class="line"><thead><tr><th>DESCRIPTION</th><th>QTY</th><th>UNIT PRICE</th><th>AMOUNT</th></tr></thead><tbody>${(Array.isArray(invoice.lineItems) && invoice.lineItems.length ? invoice.lineItems : [{description:"Services / goods",quantity:1,unitPrice:invoice.amount}]).map(item => { const lineTotal = Number(item.quantity) * Number(item.unitPrice); return `<tr><td>${escapeHTML(item.description)}</td><td>${escapeHTML(item.quantity)}</td><td>${escapeHTML(money(item.unitPrice, invoice.currency))}</td><td>${escapeHTML(money(lineTotal, invoice.currency))}</td></tr>`; }).join("")}</tbody></table>
<div class="totals"><div><span>Subtotal</span><span>${escapeHTML(money(invoiceSubtotal, invoice.currency))}</span></div><div><span>Tax (${escapeHTML(invoiceTaxRate)}%)</span><span>${escapeHTML(money(invoiceTaxAmount, invoice.currency))}</span></div><div class="grand-total"><span>TOTAL</span><span>${escapeHTML(money(invoice.amount, invoice.currency))}</span></div></div>
<div class="note"><strong>DEMO DOCUMENT — NOT A TAX INVOICE</strong><br>This document was generated from the SmartPay AI demonstration workspace. Payments are restricted to PayPal Sandbox; no real funds are collected through this document.</div>
<div class="footer">Generated with SmartPay AI · ${issuerName}<br>Invoice status reflects the latest status available in the workspace at the time this document was generated.</div>
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
  const overdueInvoices = invoices.filter(invoice => getInvoiceDisplayStatus(invoice) === "OVERDUE");
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

function renderCashFlowForecast() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOffset = days => {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return date;
  };
  const dateKey = date => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  };
  const openInvoices = invoices.filter(invoice => invoice.status !== "PAID");
  const currencies = [...new Set(openInvoices.map(invoice => invoice.currency || "USD"))];
  const container = $("#cashFlowForecast");
  if (!container) return;

  const amountFor = list => list.reduce((sum, invoice) => sum + Math.round(Number(invoice.amount || 0) * 100), 0) / 100;
  const groups = currencies.map(currency => {
    const items = openInvoices.filter(invoice => (invoice.currency || "USD") === currency);
    const overdue = items.filter(invoice => invoice.status === "OVERDUE" || invoice.dueDate < dateKey(today));
    const next7 = items.filter(invoice => invoice.status !== "OVERDUE" && invoice.dueDate >= dateKey(today) && invoice.dueDate <= dateKey(dateOffset(7)));
    const days8to30 = items.filter(invoice => invoice.status !== "OVERDUE" && invoice.dueDate > dateKey(dateOffset(7)) && invoice.dueDate <= dateKey(dateOffset(30)));
    const beyond30 = items.filter(invoice => invoice.dueDate > dateKey(dateOffset(30)));
    return { currency, items, overdue, next7, days8to30, beyond30 };
  });

  if (!openInvoices.length) {
    container.innerHTML = '<p class="chart-empty">No outstanding invoices. Your recorded receivables are fully settled.</p>';
    return;
  }

  container.innerHTML = groups.map(group => {
    const card = (label, value, note, extraClass = "") => `
      <article class="stat-card ${extraClass}">
        <div class="stat-top">${label}</div>
        <div class="stat-value">${escapeHTML(money(amountFor(value), group.currency))}</div>
        <div class="stat-note">${value.length} invoice${value.length === 1 ? "" : "s"} · ${note}</div>
      </article>`;
    const total7 = amountFor(group.overdue) + amountFor(group.next7);
    const total30 = total7 + amountFor(group.days8to30);
    const max = Math.max(1, total30);
    const overdueWidth = Math.min(100, amountFor(group.overdue) / max * 100);
    const next7Width = Math.min(100 - overdueWidth, amountFor(group.next7) / max * 100);
    const days8Width = Math.max(0, 100 - overdueWidth - next7Width);
    return `
      <div class="forecast-currency-group">
        <div class="eyebrow">${escapeHTML(group.currency)} · OUTSTANDING RECEIVABLES</div>
        <div class="stats forecast-stats">
          ${card("Overdue now", group.overdue, "requires follow-up", "alert-card")}
          ${card("Due in 7 days", group.next7, "scheduled by due date")}
          ${card("Due in 8–30 days", group.days8to30, "scheduled by due date")}
          ${card("Beyond 30 days", group.beyond30, "later receivables")}
        </div>
        <div class="forecast-total-row">
          <span>Scheduled / overdue through next 30 days</span>
          <strong>${escapeHTML(money(total30, group.currency))}</strong>
        </div>
        <div class="collection-bar forecast-bar" role="img" aria-label="Overdue and upcoming receivables distribution">
          <span class="collection-bar-paid" style="width:${overdueWidth}%"></span>
          <span class="collection-bar-open" style="width:${next7Width}%"></span>
          <span class="forecast-bar-later" style="width:${days8Width}%"></span>
        </div>
        <div class="monthly-chart-legend forecast-legend">
          <span><i class="legend-dot red-dot"></i> Overdue</span>
          <span><i class="legend-dot paid-dot"></i> Due in 7 days</span>
          <span><i class="legend-dot invoice-dot"></i> Due in 8–30 days</span>
        </div>
      </div>`;
  }).join("");

  const overdueAll = openInvoices.filter(invoice => invoice.status === "OVERDUE" || invoice.dueDate < dateKey(today));
  const soonAll = openInvoices.filter(invoice => invoice.dueDate >= dateKey(today) && invoice.dueDate <= dateKey(dateOffset(7)));
  const recommendation = document.createElement("p");
  recommendation.className = "overdue-detail";
  recommendation.textContent = overdueAll.length
    ? "Priority: review " + overdueAll.length + " overdue invoice(s) first, then prepare reminders for invoices due within 7 days (" + soonAll.length + ")."
    : soonAll.length
      ? "Preventive action: no invoices are overdue. Review the " + soonAll.length + " invoice(s) due within 7 days."
      : "No invoices are currently overdue or due within the next 7 days. Monitor upcoming due dates.";
  container.appendChild(recommendation);

  const aiReview = document.createElement("section");
  aiReview.className = "forecast-ai-review";
  const aiHeading = document.createElement("strong");
  aiHeading.textContent = "AI COLLECTION RISK REVIEW";
  const aiDescription = document.createElement("p");
  aiDescription.textContent = "Ask SmartPay AI to rank unpaid invoices by qualitative risk, explain the evidence, and recommend the next collection action.";
  const aiButton = document.createElement("button");
  aiButton.type = "button";
  aiButton.className = "draft-button";
  aiButton.textContent = "Analyze collection risks with AI";
  const aiResult = document.createElement("div");
  aiResult.className = "forecast-ai-result";
  aiResult.hidden = true;
  aiButton.addEventListener("click", async () => {
    aiButton.disabled = true;
    aiButton.textContent = "Analyzing invoices…";
    aiResult.hidden = false;
    aiResult.textContent = "Reviewing current unpaid invoices and due dates…";
    const question = [
      "Perform a collection-risk review of every invoice that is not PAID in the supplied live invoice data.",
      "Rank all outstanding invoices from highest to lowest collection priority.",
      "For each invoice give: invoice ID, customer, amount and currency, status, due date, days overdue or days until due, qualitative risk level (HIGH, MEDIUM, LOW), the specific evidence for that level, and one practical next collection action.",
      "Prioritize actual overdue invoices first, then invoices due soon, while considering the outstanding amount as exposure.",
      "Do not invent payment history, customer behavior, promises, or statistical probabilities. Do not assign percentage chances of payment or default. This is a qualitative operational assessment, not a trained predictive model.",
      "Keep currencies separate. Exclude PAID invoices. Do not claim that a reminder was sent or payment was collected.",
      "Do not use a Markdown table. Return one compact labeled block per invoice, copying each invoice ID exactly. Include customer, amount/currency, status, due date, timing, risk, evidence, and next action. Finish with the top three actions. Never omit an outstanding invoice; use only supplied data."
    ].join(" ");
    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ question })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI risk review is unavailable.");
      const outstanding = invoices.filter(invoice => invoice.status !== "PAID");
      const answer = String(data.answer || "").trim();
      const invoiceIdCounts = outstanding.map(invoice => {
        const invoiceId = String(invoice.id);
        const matches = answer.match(new RegExp("INVOICE\\s*:\\s*" + invoiceId + "(?=\\s*;|\\s|$)", "gi")) || [];
        return { id: invoiceId, count: matches.length };
      });
      const completeAIReview = outstanding.length > 0 &&
        invoiceIdCounts.every(item => item.count === 1) &&
        answer.length > 250;
      const missingAIInvoiceIds = outstanding.filter(invoice => !answer.includes(String(invoice.id))).map(invoice => String(invoice.id));
      if (completeAIReview) {
        renderRiskReview(aiResult, answer, data.provider);
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
        const ranked = outstanding.map(invoice => {
          const due = String(invoice.dueDate || "").trim();
          const validDue = /^\d{4}-\d{2}-\d{2}$/.test(due) && !Number.isNaN(Date.parse(due + "T00:00:00"));
          const dueTime = validDue ? Date.parse(due + "T00:00:00") : NaN;
          const daysPastDue = validDue ? Math.floor((today.getTime() - dueTime) / 86400000) : null;
          const daysUntilDue = validDue ? Math.ceil((dueTime - today.getTime()) / 86400000) : null;
          const overdue = invoice.status === "OVERDUE" || (daysPastDue !== null && daysPastDue > 0);
          const dueSoon = !overdue && daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7;
          const risk = overdue ? "HIGH" : dueSoon ? "MEDIUM" : "LOW";
          const evidence = overdue
            ? (daysPastDue > 0 ? daysPastDue + " day(s) past due; status " + invoice.status + "." : "Invoice is marked OVERDUE.")
            : dueSoon ? (daysUntilDue === 0 ? "Due today." : "Due in " + daysUntilDue + " day(s).") :
              validDue ? "Not overdue; due date is " + due + "." : "Due date is missing or invalid; verify invoice details.";
          const action = overdue
            ? "Contact the customer promptly, confirm the payment date, and share the secure invoice link if available."
            : dueSoon ? "Send a friendly due-date reminder and confirm the expected payment date."
            : "Monitor until the reminder window; verify the due date if missing.";
          return { invoice, risk, evidence, action, daysPastDue, daysUntilDue, amount: Number(invoice.amount || 0) };
        }).sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.risk] - { HIGH: 0, MEDIUM: 1, LOW: 2 }[b.risk] || b.amount - a.amount));
        const sections = ranked.map((item, index) => {
          const invoice = item.invoice;
          const currency = invoice.currency || "USD";
          const amount = money(item.amount, currency);
          return (index + 1) + ". " + invoice.id + " — " + (invoice.customer || "Customer not recorded") +
            " — " + amount + "\nRisk: " + item.risk + "\nStatus: " + invoice.status +
            " · Due: " + (invoice.dueDate || "Not recorded") + "\nEvidence: " + item.evidence +
            "\nNext action: " + item.action;
        });
        renderRiskFallback(aiResult, ranked, data.provider, missingAIInvoiceIds);
      }
      aiButton.textContent = "Run analysis again";
    } catch (error) {
      aiResult.textContent = error.message || "Could not complete the AI risk review.";
      aiButton.textContent = "Try analysis again";
    } finally {
      aiButton.disabled = false;
    }
  });
  aiReview.append(aiHeading, aiDescription, aiButton, aiResult);
  container.appendChild(aiReview);
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
    const currencyGroups = new Map();
    data.forEach(item => {
      const currency = String(item.currency || "USD").toUpperCase();
      if (!currencyGroups.has(currency)) currencyGroups.set(currency, []);
      currencyGroups.get(currency).push(item);
    });
    const formatChartMoney = (amount, currency) => {
      try { return money(amount, currency); }
      catch (_error) { return Number(amount || 0).toFixed(2) + " " + currency; }
    };
    container.style.gridTemplateColumns = "minmax(0, 1fr)";
    container.innerHTML = Array.from(currencyGroups.entries()).map(([currency, rawItems], groupIndex) => {
      const items = rawItems.slice().sort((a,b) => String(a.month || a.label).localeCompare(String(b.month || b.label)));
      const maxValue = Math.max(1, ...items.flatMap(item => [
        Number(item.invoicedAmount || 0), Number(item.collectedAmount || 0), Number(item.demoCollectedAmount || 0)
      ]));
      const ticks = [1, .75, .5, .25, 0];
      const axis = ticks.map(ratio => '<span>' + escapeHTML(formatChartMoney(maxValue * ratio, currency)) + '</span>').join("");
      const columns = items.map((item,index) => {
        const values = [
          { key:"invoicedAmount", label:"Invoiced", css:"invoice-bar", value:Number(item.invoicedAmount || 0) },
          { key:"collectedAmount", label:"PayPal captured", css:"collected-bar", value:Number(item.collectedAmount || 0) },
          { key:"demoCollectedAmount", label:"Demo collections", css:"demo-collected-bar", value:Number(item.demoCollectedAmount || 0) }
        ];
        const bars = values.map(series => '<span class="month-bar ' + series.css + '" style="height:' + (series.value > 0 ? Math.max(1.5, series.value / maxValue * 100) : 0) + '%" aria-hidden="true"></span>').join("");
        const monthName = item.label || item.month || "Month";
        return '<button type="button" class="month-column' + (index === items.length-1 ? ' is-selected' : '') + '" data-month-index="' + index + '" aria-pressed="' + (index === items.length-1 ? 'true':'false') + '">' +
          '<span class="month-bars" aria-label="' + escapeHTML(monthName) + '">' + bars + '</span>' +
          '<span class="month-label">' + escapeHTML(monthName) + '</span></button>';
      }).join("");
      const selected = items[items.length-1];
      const detail = '<div class="month-detail" id="monthDetail' + groupIndex + '">' +
        '<strong>' + escapeHTML(selected.label || selected.month || "Month") + ' · ' + escapeHTML(currency) + '</strong>' +
        '<div><span><i class="legend-dot invoice-dot"></i> Invoiced</span><b>' + escapeHTML(formatChartMoney(selected.invoicedAmount, currency)) + '</b></div>' +
        '<div><span><i class="legend-dot paid-dot"></i> PayPal captured</span><b>' + escapeHTML(formatChartMoney(selected.collectedAmount, currency)) + '</b></div>' +
        '<div><span><i class="legend-dot demo-paid-dot"></i> Demo collections</span><b>' + escapeHTML(formatChartMoney(selected.demoCollectedAmount, currency)) + '</b></div></div>';
      return '<section class="monthly-currency-group" data-currency-group="' + groupIndex + '" aria-label="Monthly performance in ' + escapeHTML(currency) + '">' +
        '<div class="monthly-currency-heading">' + escapeHTML(currency) + '</div>' +
        '<div class="chart-with-axis"><div class="chart-y-axis">' + axis + '</div><div class="monthly-chart-months" data-months="' + months + '">' + columns + '</div></div>' + detail + '</section>';
    }).join("");
    container.querySelectorAll(".monthly-currency-group").forEach(group => {
      const groupIndex = Number(group.dataset.currencyGroup);
      const currency = group.querySelector(".monthly-currency-heading").textContent;
      const items = currencyGroups.get(currency) || [];
      const buttons = [...group.querySelectorAll("[data-month-index]")];
      const detail = group.querySelector(".month-detail");
      buttons.forEach(button => button.addEventListener("click", () => {
        const item = items[Number(button.dataset.monthIndex)];
        buttons.forEach(other => {
          const active = other === button;
          other.classList.toggle("is-selected", active);
          other.setAttribute("aria-pressed", active ? "true" : "false");
        });
        const format = value => formatChartMoney(value, currency);
        detail.innerHTML = '<strong>' + escapeHTML(item.label || item.month || "Month") + ' · ' + escapeHTML(currency) + '</strong>' +
          '<div><span><i class="legend-dot invoice-dot"></i> Invoiced</span><b>' + escapeHTML(format(item.invoicedAmount)) + '</b></div>' +
          '<div><span><i class="legend-dot paid-dot"></i> PayPal captured</span><b>' + escapeHTML(format(item.collectedAmount)) + '</b></div>' +
          '<div><span><i class="legend-dot demo-paid-dot"></i> Demo collections</span><b>' + escapeHTML(format(item.demoCollectedAmount)) + '</b></div>';
      }));
    });
  } catch (error) {
    console.error("Monthly analytics loading failed:", error);
    container.innerHTML = '<p class="chart-empty">Monthly chart could not load. Refresh the page to retry.</p>';
  }
}

function getInvoiceDisplayStatus(invoice) {
  if (invoice.status === "PAID") return "PAID";
  const now = new Date();
  const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  return invoice.dueDate && invoice.dueDate < today ? "OVERDUE" : (invoice.status || "UNPAID");
}

let invoicePage = 1;
let invoicePageRows = [];
const invoicePageSize = 20;

async function renderInvoices() {
  const rows = $("#invoiceRows");
  if (!rows) return;
  const query = ($("#invoiceSearch")?.value || "").trim();
  const status = $("#invoiceStatusFilter")?.value || "ALL";
  const from = $("#invoiceDateFrom")?.value || "";
  const to = $("#invoiceDateTo")?.value || "";
  rows.innerHTML = '<tr><td colspan="5">Loading invoices…</td></tr>';
  try {
    const params = new URLSearchParams({ page:String(invoicePage), pageSize:String(invoicePageSize), q:query, status, from, to });
    const response = await fetch("/api/invoices/page?" + params.toString(), { cache:"no-store", headers:{ "Accept":"application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load invoices.");
    invoicePageRows = Array.isArray(data.items) ? data.items : [];
    const total = Number(data.total || 0);
    const totalPages = Math.max(1, Number(data.totalPages || 1));
    if (invoicePage > totalPages) { invoicePage = totalPages; return renderInvoices(); }
    rows.innerHTML = invoicePageRows.map(invoice => {
      const displayStatus = getInvoiceDisplayStatus(invoice);
      return '<tr class="' + (displayStatus === "PAID" ? "invoice-row--paid" : displayStatus === "OVERDUE" ? "invoice-row--overdue" : "invoice-row--upcoming") + '">' +
        '<td><strong>' + escapeHTML(invoice.id) + '</strong><small>' + escapeHTML(invoice.customer) + '</small></td>' +
        '<td>' + escapeHTML(invoice.dueDate) + '</td>' +
        '<td class="amount">' + money(invoice.amount, invoice.currency) + (Number(invoice.taxRate || 0) > 0 ? '<small>Includes ' + escapeHTML(invoice.taxRate) + '% tax</small>' : '') + '</td>' +
        '<td><span class="status ' + escapeHTML(displayStatus) + '">' + escapeHTML(displayStatus) + '</span></td>' +
        '<td class="invoice-actions-cell">' + (invoice.status !== "PAID" && !invoice.paypalOrderId ? '<button class="edit-button" data-edit-invoice="' + escapeHTML(invoice.id) + '">Edit</button><button class="delete-button" data-delete-invoice="' + escapeHTML(invoice.id) + '">Delete</button>' : '') + (invoice.status === "PAID" ? '—' : '<button class="pay-button" data-collect-invoice="' + escapeHTML(invoice.id) + '">Collect Payment</button>') + (invoice.paymentToken ? '<button class="share-button" data-copy-payment-link="' + escapeHTML(invoice.paymentToken) + '">Copy payment link</button>' : '') + '<button class="pdf-button" data-pdf-invoice="' + escapeHTML(invoice.id) + '">PDF</button></td></tr>';
    }).join("");
    if (!invoicePageRows.length) rows.innerHTML = '<tr><td colspan="5">No matching invoices.</td></tr>';
    const summary = $("#invoicePaginationSummary");
    if (summary) summary.textContent = total ? 'Showing ' + ((invoicePage-1)*invoicePageSize+1) + '–' + Math.min(invoicePage*invoicePageSize,total) + ' of ' + total + ' invoices' : 'No invoices found';
    const pageLabel = $("#invoicePageLabel");
    if (pageLabel) pageLabel.textContent = 'Page ' + invoicePage + ' of ' + totalPages;
    if ($("#invoicePrevPage")) $("#invoicePrevPage").disabled = invoicePage <= 1;
    if ($("#invoiceNextPage")) $("#invoiceNextPage").disabled = invoicePage >= totalPages;
    rows.querySelectorAll("[data-collect-invoice]").forEach(button => button.addEventListener("click", () => openCollectionSession(button.dataset.collectInvoice)));
    rows.querySelectorAll("[data-edit-invoice]").forEach(button => button.addEventListener("click", () => startEditInvoice(button.dataset.editInvoice)));
    rows.querySelectorAll("[data-delete-invoice]").forEach(button => button.addEventListener("click", async () => {
      const invoiceId = button.dataset.deleteInvoice;
      const invoice = invoices.find(item => item.id === invoiceId);
      if (!invoice || !window.confirm("Delete unpaid invoice " + invoiceId + " for " + invoice.customer + "? This cannot be undone.")) return;
      button.disabled = true; button.textContent = "Deleting…";
      try {
        const result = await fetch("/api/invoices/" + encodeURIComponent(invoiceId), { method:"DELETE", headers:{ "Accept":"application/json" } });
        const body = await result.json();
        if (!result.ok) throw new Error(body.error || "Could not delete invoice.");
        await refreshDashboard();
      } catch (error) { window.alert(error.message || "Could not delete invoice."); renderInvoices(); }
    }));
    rows.querySelectorAll("[data-pdf-invoice]").forEach(button => button.addEventListener("click", () => openInvoicePDF(button.dataset.pdfInvoice)));
    rows.querySelectorAll("[data-copy-payment-link]").forEach(button => button.addEventListener("click", async () => {
      const url = window.location.origin + "/pay/" + encodeURIComponent(button.dataset.copyPaymentLink);
      try { await navigator.clipboard.writeText(url); button.textContent = "Link copied"; }
      catch (_) { window.prompt("Copy this secure customer payment link:", url); }
    }));
  } catch (error) {
    rows.innerHTML = '<tr><td colspan="5">Could not load invoices. ' + escapeHTML(error.message) + '</td></tr>';
  }
}

function startEditInvoice(invoiceId) {
  const invoice = invoices.find(item => item.id === invoiceId);
  if (!invoice) return;
  const form = $("#createInvoiceForm");
  form.elements.invoiceId.value = invoice.id;
  form.elements.customer.value = invoice.customer;
  form.elements.email.value = invoice.email;
  $("#invoiceItemRows").innerHTML = "";
  (Array.isArray(invoice.lineItems) && invoice.lineItems.length ? invoice.lineItems : [{description:"Services / goods",quantity:1,unitPrice:invoice.amount}]).forEach(item => addInvoiceItemRow(item));
  updateInvoiceItemsTotal();
  form.elements.dueDate.value = invoice.dueDate;
  $("#invoiceTaxRate").value = Number(invoice.taxRate || 0);
  updateInvoiceItemsTotal();
  form.hidden = false;
  $("#showCreateInvoiceButton").hidden = true;
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
    ['Invoice ID','Customer','Email','Subtotal','Tax %','Total','Currency','Status','Due Date'],
    invoices.map(x => {
      const subtotal = (Array.isArray(x.lineItems) ? x.lineItems : []).reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
      return [x.id,x.customer,x.email,subtotal.toFixed(2),Number(x.taxRate || 0),x.amount,x.currency,getInvoiceDisplayStatus(x),x.dueDate];
    }));
}

function exportPaymentsCSV() {
  downloadCSV('smartpay-payment-history.csv',
    ['Invoice ID','Customer','Amount','Currency','Result','PayPal Capture ID','PayPal Order ID','Date'],
    paymentHistory.map(x => [x.invoiceId,x.customer,x.amount,x.currency,x.eventType || 'PAYMENT_CAPTURED',x.captureId,x.paypalOrderId,x.createdAt]));
}

async function loadMerchantProfile() {
  const response = await fetch("/api/merchant-profile", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load merchant details.");
  currentMerchantProfile = { ...currentMerchantProfile, ...await response.json() };
  const form = $("#merchantProfileForm");
  for (const field of Object.keys(currentMerchantProfile)) {
    if (form.elements[field]) form.elements[field].value = currentMerchantProfile[field] || "";
  }
}

$("#merchantProfileForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#saveMerchantProfileButton");
  const message = $("#merchantProfileMessage");
  button.disabled = true;
  button.textContent = "Saving…";
  message.textContent = "Saving merchant details…";
  try {
    const profile = Object.fromEntries(["businessName", "address", "email", "phone", "taxNumber"].map(field => [field, form.elements[field].value.trim()]));
    const response = await fetch("/api/merchant-profile", { method: "PUT", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(profile) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save merchant details.");
    currentMerchantProfile = data.profile;
    message.textContent = "Merchant details saved. New invoices will use this seller profile.";
    message.className = "success-message";
  } catch (error) {
    message.textContent = error.message;
    message.className = "error-message";
  } finally {
    button.disabled = false;
    button.textContent = "Save merchant details";
  }
});


function renderActionCenter() {
  const container = document.querySelector("#actionCenterList");
  const paidContainer = document.querySelector("#actionCenterPaidList");
  const count = document.querySelector("#actionCenterCount");
  if (!container) return;

  const now = new Date();
  const todayKey = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntil = invoice => {
    const due = new Date(String(invoice.dueDate || "") + "T00:00:00");
    if (Number.isNaN(due.getTime())) return null;
    return Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()) - startOfToday) / 86400000);
  };

  const overdue = invoices.filter(invoice => invoice.status !== "PAID" &&
    (invoice.status === "OVERDUE" || (daysUntil(invoice) !== null && daysUntil(invoice) < 0)));
  const upcoming = invoices.filter(invoice => {
    if (invoice.status === "PAID" || invoice.status === "OVERDUE") return false;
    const days = daysUntil(invoice);
    return days !== null && days >= 0 && days <= 3;
  }).sort((a, b) => daysUntil(a) - daysUntil(b));

  const capturedToday = paymentHistory.filter(payment => {
    const paidAt = new Date(payment.createdAt);
    if (Number.isNaN(paidAt.getTime())) return false;
    const key = [paidAt.getFullYear(), String(paidAt.getMonth() + 1).padStart(2, "0"), String(paidAt.getDate()).padStart(2, "0")].join("-");
    return key === todayKey;
  });

  container.replaceChildren();
  if (paidContainer) paidContainer.replaceChildren();

  const totalTasks = overdue.length + upcoming.length;
  if (count) count.textContent = totalTasks ? totalTasks + " tasks need attention" : "No urgent tasks";

  const addGroup = (host, title, items, tone, emptyText, renderItem) => {
    if (!host) return;
    const group = document.createElement("section");
    group.className = "action-center-group";
    const heading = document.createElement("h3");
    heading.className = "action-center-subtitle";
    heading.textContent = title + (items.length ? " · " + items.length : "");
    group.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "action-center-group-empty";
      empty.textContent = emptyText;
      group.appendChild(empty);
    } else {
      items.forEach(item => group.appendChild(renderItem(item, tone)));
    }
    host.appendChild(group);
  };

  const invoiceCard = (invoice, tone) => {
    const card = document.createElement("article");
    card.className = "action-center-item " + tone;
    const details = document.createElement("div");
    details.className = "action-center-details";
    const heading = document.createElement("strong");
    heading.textContent = invoice.id + " · " + (invoice.customer || "Customer");
    const meta = document.createElement("span");
    meta.textContent = money(invoice.amount, invoice.currency || "USD") + " · Due " + (invoice.dueDate || "date unavailable");
    const reason = document.createElement("p");
    reason.className = "action-center-reason";
    const days = daysUntil(invoice);
    reason.textContent = tone === "overdue"
      ? "Payment overdue by " + Math.max(1, Math.abs(days ?? 1)) + " day(s)."
      : days === 0 ? "Payment due today."
      : "Payment due in " + days + " day(s).";
    details.append(heading, meta, reason);

    const controls = document.createElement("div");
    controls.className = "action-center-controls";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "action-center-primary";
    if (invoice.paymentToken) {
      action.textContent = "Collect Payment";
      action.addEventListener("click", () => openCollectionSession(invoice.id));
    } else {
      action.textContent = "Prepare Reminder";
      action.addEventListener("click", () => {
        const recoveryCard = [...document.querySelectorAll("#recoveryList .recovery-item")].find(row =>
          row.querySelector(".recovery-details strong")?.textContent.includes(invoice.id)
        );
        const draftButton = recoveryCard?.querySelector(".draft-button");
        if (draftButton) draftButton.click();
        else document.querySelector("#recovery")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    controls.appendChild(action);
    card.append(details, controls);
    return card;
  };

  addGroup(container, "OVERDUE · ACTION REQUIRED", overdue, "overdue",
    "No overdue invoices.", invoice => invoiceCard(invoice, "overdue"));
  addGroup(container, "UPCOMING · DUE WITHIN 3 DAYS", upcoming, "upcoming",
    "No payments due within the next 3 days.", invoice => invoiceCard(invoice, "upcoming"));

  const completed = capturedToday.map(payment => {
    const invoice = invoices.find(item => item.id === payment.invoiceId);
    return { payment, invoice };
  });
  addGroup(paidContainer, "COMPLETED TODAY · PAYMENTS RECEIVED", completed, "completed",
    "No payments have been captured today.", item => {
      const row = document.createElement("article");
      row.className = "action-center-item completed";
      const details = document.createElement("div");
      details.className = "action-center-details";
      const heading = document.createElement("strong");
      heading.textContent = item.payment.invoiceId + " · " + (item.payment.customer || item.invoice?.customer || "Customer");
      const meta = document.createElement("span");
      meta.textContent = money(item.payment.amount, item.payment.currency || "USD") + " · Payment captured today";
      details.append(heading, meta);
      const controls = document.createElement("div");
      controls.className = "action-center-controls";
      if (item.invoice) {
        const pdf = document.createElement("button");
        pdf.type = "button";
        pdf.className = "action-center-secondary";
        pdf.textContent = "View Invoice PDF";
        pdf.addEventListener("click", () => openInvoicePDF(item.invoice.id));
        controls.appendChild(pdf);
      }
      row.append(details, controls);
      return row;
    });
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
    renderActionCenter();

    renderFinancialDashboard();
    renderCashFlowForecast();
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
  const now = new Date();
  const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  const daysLateFor = invoice => Math.max(0, Math.floor(
    (Date.parse(today + "T00:00:00Z") - Date.parse(invoice.dueDate + "T00:00:00Z")) / 86400000
  ));
  const overdue = outstanding.filter(invoice => invoice.status === "OVERDUE" || daysLateFor(invoice) > 0);
  const overdueCents = overdue.reduce((sum, invoice) => sum + Math.round(Number(invoice.amount) * 100), 0);
  const outstandingCents = outstanding.reduce((sum, invoice) => sum + Math.round(Number(invoice.amount) * 100), 0);
  const aging1to7 = overdue.filter(invoice => daysLateFor(invoice) >= 1 && daysLateFor(invoice) <= 7);
  const aging8to30 = overdue.filter(invoice => daysLateFor(invoice) >= 8 && daysLateFor(invoice) <= 30);
  const aging31 = overdue.filter(invoice => daysLateFor(invoice) >= 31);
  const overdueAmount = list => list.reduce((sum, invoice) => sum + Math.round(Number(invoice.amount || 0) * 100), 0);
  const currency = outstanding[0]?.currency || "USD";

  const insights = document.createElement("div");
  insights.className = "recovery-insights";
  const metrics = [
    { label: "Outstanding balance", value: money(outstandingCents / 100, currency) },
    { label: "Overdue exposure", value: money(overdueCents / 100, currency) },
    { label: "1–7 days late", value: aging1to7.length + " · " + money(overdueAmount(aging1to7) / 100, currency) },
    { label: "8–30 days late", value: aging8to30.length + " · " + money(overdueAmount(aging8to30) / 100, currency) },
    { label: "31+ days late", value: aging31.length + " · " + money(overdueAmount(aging31) / 100, currency) }
  ];
  metrics.forEach(metric => {
    const item = document.createElement("div");
    item.className = "recovery-insight";
    const label = document.createElement("span");
    label.textContent = metric.label;
    const value = document.createElement("strong");
    value.textContent = metric.value;
    item.append(label, value);
    insights.appendChild(item);
  });
  container.appendChild(insights);

  const sorted = [...outstanding].sort((left, right) => {
    const leftLate = daysLateFor(left);
    const rightLate = daysLateFor(right);
    const leftPriority = leftLate > 0 || left.status === "OVERDUE" ? 3
      : (Date.parse(left.dueDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000 <= 3 ? 2 : 1;
    const rightPriority = rightLate > 0 || right.status === "OVERDUE" ? 3
      : (Date.parse(right.dueDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000 <= 3 ? 2 : 1;
    return rightPriority - leftPriority || rightLate - leftLate || Number(right.amount) - Number(left.amount);
  });

  const recommendation = document.createElement("p");
  recommendation.className = "recovery-recommendation";
  if (overdue.length) {
    const topTarget = [...overdue].sort((a, b) =>
      daysLateFor(b) - daysLateFor(a) || Number(b.amount) - Number(a.amount)
    )[0];
    const largestExposure = [...overdue].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    recommendation.textContent = "SMART PRIORITY: Contact " + topTarget.customer + " (" + topTarget.id + ") first — " +
      daysLateFor(topTarget) + " days overdue. " +
      "Largest overdue balance: " + largestExposure.customer + " (" + money(largestExposure.amount, largestExposure.currency) + "). " +
      (aging31.length ? "Escalate review of " + aging31.length + " invoice(s) aged 31+ days." : "Request a firm payment date and include the secure invoice payment link.");
  } else if (outstanding.length) {
    const nextDue = [...outstanding].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    recommendation.textContent = "PREVENTIVE ACTION: No invoices are overdue. Send a friendly reminder for " +
      nextDue.customer + " (" + nextDue.id + "), due " + nextDue.dueDate + ".";
  } else {
    recommendation.textContent = "PORTFOLIO CLEAR: All invoices are paid. No recovery actions are needed.";
  }
  container.appendChild(recommendation);

  if (!sorted.length) {
    const empty = document.createElement("p");
    empty.className = "recovery-empty";
    empty.textContent = "All invoices are paid. No recovery actions are needed.";
    container.appendChild(empty);
    return;
  }

  sorted.forEach(invoice => {
    const daysLate = daysLateFor(invoice);
    const daysUntilDue = Math.ceil((Date.parse(invoice.dueDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    const priority = daysLate > 0 || invoice.status === "OVERDUE" ? "HIGH" : daysUntilDue <= 3 ? "MEDIUM" : "LOW";
    const priorityReason = priority === "HIGH"
      ? (daysLate > 0 ? "Past due by " + daysLate + " day(s) · collect now" : "Marked overdue · verify payment status")
      : priority === "MEDIUM"
        ? "Due within " + Math.max(0, daysUntilDue) + " day(s) · prevent late payment"
        : "Not yet due · monitor until closer to due date";
    const nextAction = priority === "HIGH"
      ? "Next action: request a confirmed payment date"
      : priority === "MEDIUM"
        ? "Next action: send a friendly pre-due reminder"
        : "Next action: schedule a follow-up closer to the due date";
    const card = document.createElement("article");
    card.className = "recovery-item";
    const details = document.createElement("div");
    details.className = "recovery-details";
    const name = document.createElement("strong");
    name.textContent = invoice.customer + " · " + invoice.id;
    const meta = document.createElement("span");
    meta.textContent = money(invoice.amount, invoice.currency) + " · Due " + invoice.dueDate + " · " + invoice.email;
    const reason = document.createElement("span");
    reason.textContent = priorityReason;
    reason.className = "recovery-reason";
    const action = document.createElement("span");
    action.textContent = nextAction;
    action.className = "recovery-next-action";
    details.append(name, meta, reason, action);
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
        let safePaymentUrl;
        try { safePaymentUrl = new URL(data.paymentUrl, window.location.origin); } catch (_) { throw new Error("The secure invoice link is invalid."); }
        if (safePaymentUrl.origin !== window.location.origin || !safePaymentUrl.pathname.startsWith("/pay/")) throw new Error("The secure invoice link is not trusted.");

        const rawEmail = String(data.draft || "");
        const paymentMarker = "\n\nView invoice and pay securely:";
        const paymentMarkerIndex = rawEmail.indexOf(paymentMarker);
        const generatedText = (paymentMarkerIndex >= 0 ? rawEmail.slice(0, paymentMarkerIndex) : rawEmail).trim();
        const subjectMatch = generatedText.match(/(?:^|\n)Subject:\s*(.+)/i);
        const messageMatch = generatedText.match(/(?:^|\n)Message:\s*([\s\S]*)/i);
        const subjectValue = subjectMatch ? subjectMatch[1].trim() : "Payment reminder — " + data.invoiceId;
        let messageValue = messageMatch ? messageMatch[1].trim() : generatedText;
        messageValue = messageValue.replace(/^Subject:\s*.*(?:\n|$)/i, "").replace(/^Message:\s*/i, "").trim();
        const paymentLine = "View invoice and pay securely: " + safePaymentUrl.href;
        if (!messageValue.includes(safePaymentUrl.href)) messageValue += (messageValue ? "\n\n" : "") + paymentLine;

        draft.replaceChildren();
        const editor = document.createElement("div");
        editor.className = "recovery-email-editor";
        const recipientLabel = document.createElement("label");
        recipientLabel.className = "recovery-email-meta";
        recipientLabel.textContent = "TO — CUSTOMER EMAIL";
        const recipientInput = document.createElement("input");
        recipientInput.type = "email";
        recipientInput.className = "recovery-email-recipient";
        recipientInput.maxLength = 254;
        recipientInput.autocomplete = "email";
        recipientInput.placeholder = "customer@example.com";
        recipientInput.value = data.email || "";
        recipientLabel.appendChild(recipientInput);
        const subjectLabel = document.createElement("label");
        subjectLabel.textContent = "EMAIL SUBJECT";
        const subjectInput = document.createElement("input");
        subjectInput.type = "text";
        subjectInput.className = "recovery-email-subject";
        subjectInput.maxLength = 180;
        subjectInput.value = subjectValue.replace(/^Draft:\s*/i, "");
        subjectLabel.appendChild(subjectInput);
        const messageLabel = document.createElement("label");
        messageLabel.textContent = "MESSAGE — EDIT BEFORE SENDING";
        const messageArea = document.createElement("textarea");
        messageArea.className = "recovery-email-message";
        messageArea.rows = 9;
        messageArea.maxLength = 12000;
        messageArea.value = messageValue.replace(/\bDraft only — not sent\.?/gi, "").trim();
        const paymentLink = document.createElement("a");
        paymentLink.href = safePaymentUrl.href;
        paymentLink.target = "_blank";
        paymentLink.rel = "noopener noreferrer";
        paymentLink.textContent = "Preview secure invoice & payment page";
        paymentLink.className = "recovery-payment-link";
        const actionsRow = document.createElement("div");
        actionsRow.className = "recovery-email-actions";
        const sendButton = document.createElement("button");
        sendButton.type = "button";
        sendButton.className = "recovery-send-email";
        sendButton.textContent = "Open Email App";
        sendButton.addEventListener("click", () => {
          const recipient = recipientInput.value.trim();
          const subject = subjectInput.value.trim();
          const message = messageArea.value.trim();
          if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
            helper.textContent = "Enter a valid customer email address to continue.";
            helper.className = "recovery-email-helper error-message";
            recipientInput.focus();
            return;
          }
          if (!subject || !message) {
            helper.textContent = "Enter both an email subject and message before continuing.";
            helper.className = "recovery-email-helper error-message";
            return;
          }
          const mailto = "mailto:" + recipient +
            "?subject=" + encodeURIComponent(subject) +
            "&body=" + encodeURIComponent(message);
          helper.textContent = "Requesting your default email app. If nothing opens, choose a webmail provider or copy the draft below.";
          helper.className = "recovery-email-helper";
          window.location.href = mailto;
        });
        const webmailSelect = document.createElement("select");
        webmailSelect.className = "recovery-webmail-provider";
        webmailSelect.setAttribute("aria-label", "Choose webmail provider");
        [
          ["", "Choose webmail…"],
          ["outlook", "Outlook / Microsoft 365"],
          ["gmail", "Gmail"],
          ["zoho", "Zoho Mail"]
        ].forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          webmailSelect.appendChild(option);
        });
        const webmailButton = document.createElement("button");
        webmailButton.type = "button";
        webmailButton.className = "recovery-open-webmail";
        webmailButton.textContent = "Open Webmail";
        webmailButton.addEventListener("click", () => {
          const params = new URLSearchParams({ to: recipientInput.value.trim(), subject: subjectInput.value.trim(), body: messageArea.value });
          let webmailUrl = "";
          if (webmailSelect.value === "outlook") {
            webmailUrl = "https://outlook.office.com/mail/deeplink/compose?" + params.toString();
          } else if (webmailSelect.value === "gmail") {
            webmailUrl = "https://mail.google.com/mail/?view=cm&fs=1&" + params.toString();
          } else if (webmailSelect.value === "zoho") {
            webmailUrl = "https://mail.zoho.com/";
          } else {
            helper.textContent = "Choose Outlook, Gmail or Zoho Mail first.";
            helper.className = "recovery-email-helper error-message";
            return;
          }
          if (webmailSelect.value === "zoho") {
            const copyText = "To: " + recipientInput.value.trim() + "\nSubject: " + subjectInput.value.trim() + "\n\n" + messageArea.value;
            navigator.clipboard?.writeText(copyText).catch(() => {});
            helper.textContent = "Opening Zoho Mail. The draft is also available with Copy email if it is not prefilled.";
          } else {
            helper.textContent = "Opening your selected webmail in a new tab. Review the draft and press Send yourself.";
          }
          window.open(webmailUrl, "_blank", "noopener,noreferrer");
        });
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "recovery-copy-email";
        copyButton.textContent = "Copy email";
        copyButton.addEventListener("click", async () => {
          const textToCopy = "To: " + recipientInput.value.trim() + "\nSubject: " + subjectInput.value.trim() + "\n\n" + messageArea.value;
          try {
            await navigator.clipboard.writeText(textToCopy);
            copyButton.textContent = "Copied";
            setTimeout(() => { copyButton.textContent = "Copy email"; }, 1600);
          } catch (_) {
            window.prompt("Copy the email below:", textToCopy);
          }
        });
        actionsRow.append(sendButton, webmailSelect, webmailButton, copyButton);
        const helper = document.createElement("p");
        helper.className = "recovery-email-helper";
        helper.textContent = "The email app will open with the recipient, subject and message filled in. You review and send it yourself.";
        editor.append(recipientLabel, subjectLabel, messageLabel, messageArea, paymentLink, actionsRow, helper);
        draft.appendChild(editor);
        button.textContent = "Regenerate email";
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

let collectionQrLibraryPromise = null;
let collectionPollTimer = null;
let collectionCountdownTimer = null;
let activeCollectionToken = null;

async function loadCollectionQrLibrary() {
  if (window.QRCode) return window.QRCode;
  if (collectionQrLibraryPromise) return collectionQrLibraryPromise;
  collectionQrLibraryPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-smartpay-qr="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.QRCode), { once: true });
      existing.addEventListener("error", () => reject(new Error("QR code library could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.dataset.smartpayQr = "true";
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    script.async = true;
    script.onload = () => window.QRCode ? resolve(window.QRCode) : reject(new Error("QR code library did not initialize."));
    script.onerror = () => reject(new Error("QR code library could not be loaded. Check the connection and use the payment link instead."));
    document.head.appendChild(script);
  }).catch(error => { collectionQrLibraryPromise = null; throw error; });
  return collectionQrLibraryPromise;
}

function stopCollectionTimers() {
  if (collectionPollTimer) clearInterval(collectionPollTimer);
  if (collectionCountdownTimer) clearInterval(collectionCountdownTimer);
  collectionPollTimer = null;
  collectionCountdownTimer = null;
}

function closeCollectionSession() {
  stopCollectionTimers();
  activeCollectionToken = null;
  document.getElementById("smartpayCollectionOverlay")?.remove();
}

async function openCollectionSession(invoiceId) {
  const invoice = invoices.find(item => item.id === invoiceId);
  if (!invoice || invoice.status === "PAID") return;
  if (!invoice.paymentToken) {
    window.alert("This invoice does not have a secure payment link yet. Refresh the dashboard and try again.");
    return;
  }
  closeCollectionSession();
  activeCollectionToken = invoice.paymentToken;
  const paymentUrl = window.location.origin + "/pay/" + encodeURIComponent(invoice.paymentToken);
  const overlay = document.createElement("div");
  overlay.id = "smartpayCollectionOverlay";
  overlay.className = "collection-overlay";
  overlay.innerHTML = `
    <section class="collection-dialog" role="dialog" aria-modal="true" aria-labelledby="collectionDialogTitle">
      <button type="button" class="collection-close" aria-label="Close collection window">×</button>
      <div class="eyebrow">MERCHANT COLLECTION SESSION</div>
      <h2 id="collectionDialogTitle">Collect Payment</h2>
      <p class="collection-invoice-label"></p>
      <strong class="collection-amount"></strong>
      <div class="collection-status" role="status" aria-live="polite">Waiting for customer payment</div>
      <div class="collection-qr" aria-label="Scan this QR code to open the invoice"></div>
      <p class="collection-scan-label">Customer: scan the QR code to open the secure invoice</p>
      <div class="collection-link-label">CUSTOMER PAYMENT LINK</div>
      <a class="collection-payment-link" target="_blank" rel="noopener noreferrer"></a>
      <div class="collection-actions">
        <button type="button" class="collection-copy">Copy payment link</button>
        <span class="collection-countdown">15:00</span>
      </div>
      <div class="collection-share-actions">
        <button type="button" class="collection-whatsapp">Share QR + message</button>
        <button type="button" class="collection-download-qr">Download QR image</button>
      </div>
      <p class="collection-share-note">On supported phones, choose WhatsApp from the share sheet to send the QR image and message together.</p>
      <p class="collection-session-note">This 15-minute window is a merchant-side display session. The invoice link remains valid after the window expires.</p>
    </section>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".collection-invoice-label").textContent = invoice.id + " · " + invoice.customer;
  overlay.querySelector(".collection-amount").textContent = money(invoice.amount, invoice.currency);
  const link = overlay.querySelector(".collection-payment-link");
  link.href = paymentUrl;
  link.textContent = paymentUrl;
  overlay.querySelector(".collection-close").addEventListener("click", closeCollectionSession);
  overlay.addEventListener("click", event => { if (event.target === overlay) closeCollectionSession(); });
  overlay.querySelector(".collection-copy").addEventListener("click", async event => {
    try {
      await navigator.clipboard.writeText(paymentUrl);
      event.currentTarget.textContent = "Link copied";
    } catch (_) {
      window.prompt("Copy this secure customer payment link:", paymentUrl);
    }
  });
  overlay.querySelector(".collection-whatsapp").addEventListener("click", () => {
    const message = "Hello " + invoice.customer + ", your invoice " + invoice.id + " for " + money(invoice.amount, invoice.currency) + " is ready. You can review and pay securely here: " + paymentUrl;
    const qrCanvas = overlay.querySelector(".collection-qr canvas");
    const qrImage = overlay.querySelector(".collection-qr img");
    const shareQr = async () => {
      let file = null;
      if (qrCanvas && qrCanvas.toBlob) {
        const blob = await new Promise(resolve => qrCanvas.toBlob(resolve, "image/png"));
        if (blob) file = new File([blob], "smartpay-payment-qr-" + invoice.id + ".png", { type: "image/png" });
      } else if (qrImage && qrImage.src) {
        const response = await fetch(qrImage.src);
        const blob = await response.blob();
        file = new File([blob], "smartpay-payment-qr-" + invoice.id + ".png", { type: "image/png" });
      }
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: "SmartPay payment request", text: message });
        return;
      }
      window.open("https://wa.me/?text=" + encodeURIComponent(message), "_blank", "noopener,noreferrer");
      if (file) {
        const note = overlay.querySelector(".collection-share-note");
        if (note) note.textContent = "WhatsApp opened with the payment message. Download the QR image separately and attach it in the chat.";
      }
    };
    shareQr().catch(error => {
      console.warn("WhatsApp sharing failed:", error.message);
      window.open("https://wa.me/?text=" + encodeURIComponent(message), "_blank", "noopener,noreferrer");
    });
  });
  overlay.querySelector(".collection-download-qr").addEventListener("click", () => {
    const canvas = overlay.querySelector(".collection-qr canvas");
    const image = overlay.querySelector(".collection-qr img");
    let dataUrl = canvas ? canvas.toDataURL("image/png") : image?.src;
    if (!dataUrl) {
      window.alert("The QR code is not ready yet. Please try again in a moment.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = "smartpay-payment-qr-" + invoice.id + ".png";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  });
  try {
    const QRCodeLibrary = await loadCollectionQrLibrary();
    if (activeCollectionToken !== invoice.paymentToken || !document.getElementById("smartpayCollectionOverlay")) return;
    new QRCodeLibrary(overlay.querySelector(".collection-qr"), {
      text: paymentUrl, width: 190, height: 190, colorDark: "#071a33",
      colorLight: "#ffffff", correctLevel: QRCodeLibrary.CorrectLevel.M
    });
  } catch (error) {
    overlay.querySelector(".collection-qr").textContent = "QR unavailable. Use the payment link below.";
  }

  const expiresAt = Date.now() + 15 * 60 * 1000;
  const countdown = overlay.querySelector(".collection-countdown");
  collectionCountdownTimer = setInterval(() => {
    const remaining = Math.max(0, expiresAt - Date.now());
    const minutes = String(Math.floor(remaining / 60000)).padStart(2, "0");
    const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
    countdown.textContent = minutes + ":" + seconds;
    if (remaining <= 0) {
      if (collectionCountdownTimer) clearInterval(collectionCountdownTimer);
      collectionCountdownTimer = null;
      overlay.querySelector(".collection-status").textContent = "Collection window expired";
      overlay.querySelector(".collection-status").classList.add("expired");
      overlay.querySelector(".collection-session-note").textContent = "The display session has ended. The invoice is still unpaid unless payment is confirmed. You can close this window and start a new collection session; the payment link remains valid.";
    }
  }, 1000);

  const checkPayment = async () => {
    if (activeCollectionToken !== invoice.paymentToken) return;
    try {
      const response = await fetch("/api/public-invoices/" + encodeURIComponent(invoice.paymentToken), { cache: "no-store", headers: { "Accept": "application/json" } });
      if (!response.ok) return;
      const latest = await response.json();
      if (latest.status === "PAID") {
        stopCollectionTimers();
        overlay.querySelector(".collection-status").textContent = "Payment successful · Invoice PAID";
        overlay.querySelector(".collection-status").classList.add("paid");
        overlay.querySelector(".collection-countdown").textContent = "COMPLETED";
        overlay.querySelector(".collection-session-note").textContent = "PayPal-confirmed payment detected. The invoice and payment history are being refreshed.";
        await refreshDashboard();
      }
    } catch (error) {
      console.warn("Collection status check failed:", error.message);
    }
  };
  collectionPollTimer = setInterval(checkPayment, 3000);
  checkPayment();
}

async function startPayPalCheckout(invoiceId) {
  const button = document.querySelector(`[data-invoice="${invoiceId}"]`);
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Loading…";
  try {
    await loadPayPalSdk();
    if (!window.paypal || !window.paypal.Buttons) throw new Error("PayPal checkout SDK could not initialize. Please retry in a moment.");
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

let paypalSdkLoadPromise = null;
async function loadPayPalSdk() {
  if (window.paypal && typeof window.paypal.Buttons === "function") return window.paypal;
  if (paypalSdkLoadPromise) return paypalSdkLoadPromise;
  paypalSdkLoadPromise = (async () => {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load PayPal configuration.");
    const config = await response.json();
    if (!config.paypalClientId) throw new Error("PayPal Sandbox is not configured. Please contact the administrator.");
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-smartpay-paypal-sdk="true"]');
      if (existing) {
        if (window.paypal && typeof window.paypal.Buttons === "function") return resolve();
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("PayPal SDK could not be loaded. Check the connection and retry.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.dataset.smartpayPaypalSdk = "true";
      script.async = true;
      script.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(config.paypalClientId) + "&currency=USD&intent=capture";
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error("PayPal SDK could not be loaded. Check the connection and retry."));
      };
      document.head.appendChild(script);
    });
    if (!window.paypal || typeof window.paypal.Buttons !== "function") {
      throw new Error("PayPal SDK loaded but checkout is unavailable. Please retry.");
    }
    console.log("PayPal SDK ready.");
    return window.paypal;
  })();
  try {
    return await paypalSdkLoadPromise;
  } catch (error) {
    paypalSdkLoadPromise = null;
    throw error;
  }
}

function createInvoiceActionControls(invoiceId) {
  const invoice = invoices.find(item => String(item.id) === String(invoiceId));
  if (!invoice) return null;
  const controls = document.createElement("div");
  controls.className = "assistant-invoice-controls action-center-controls";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-center-primary";
  if (invoice.status === "PAID") {
    button.textContent = "View / Save Invoice PDF";
    button.addEventListener("click", () => openInvoicePDF(invoice.id));
  } else if (invoice.paymentToken) {
    button.textContent = "Collect Payment";
    button.addEventListener("click", () => openCollectionSession(invoice.id));
  } else {
    button.textContent = "Prepare Reminder";
    button.addEventListener("click", () => {
      const recoveryCard = [...document.querySelectorAll("#recoveryList .recovery-item")].find(row =>
        row.querySelector(".recovery-details strong")?.textContent.includes(String(invoice.id))
      );
      const draftButton = recoveryCard?.querySelector(".draft-button");
      if (draftButton) draftButton.click();
      else document.querySelector("#recovery")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  controls.appendChild(button);
  return controls;
}

function renderAssistantAnswer(container, answer, provider) {
  container.replaceChildren();
  container.classList.add("ai-response-rich");
  const notice = document.createElement("div");
  notice.className = "ai-action-disclaimer";
  notice.textContent = "AI guidance only · SmartPay has not sent messages, scheduled reminders, made calls, or taken payments.";
  container.appendChild(notice);

  const lines = String(answer || "").replace(/\r\n?/g, "\n").trim().split("\n");
  let list = null, listType = "", codeLines = null;
  const flushList = () => { if (list) container.appendChild(list); list = null; listType = ""; };
  const flushCode = () => {
    if (codeLines) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n").replace(/https?:\/\/[^\s"'<>]+/gi, "").replace(/[ \t]{2,}/g, " ").trim();
      pre.appendChild(code);
      container.appendChild(pre);
    }
    codeLines = null;
  };
  const appendInline = (parent, value) => {
    value = String(value || "").replace(/https?:\/\/[^\s<]+/gi, "").replace(/[ \t]{2,}/g, " ").trim();
    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g;
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
      if (match.index > cursor) parent.appendChild(document.createTextNode(value.slice(cursor, match.index)));
      const token = match[0];
      let node;
      if (token.startsWith("**") || token.startsWith("__")) {
        node = document.createElement("strong"); node.textContent = token.slice(2, -2);
      } else if (token.startsWith("*")) {
        node = document.createElement("em"); node.textContent = token.slice(1, -1);
      } else {
        const safeUrl = token.replace(/[),.;]+$/, "");
        try {
          const parsed = new URL(safeUrl);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            node = document.createElement("a");
            node.href = parsed.href; node.target = "_blank";
            node.rel = "noopener noreferrer"; node.textContent = safeUrl;
          } else {
            node = document.createTextNode(token);
          }
        } catch { node = document.createTextNode(token); }
      }
      parent.appendChild(node); cursor = match.index + token.length;
    }
    if (cursor < value.length) parent.appendChild(document.createTextNode(value.slice(cursor)));
  };
  const addBlock = (tag, value, className) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    appendInline(element, value); container.appendChild(element);
  };
  const renderInvoiceCard = (line) => {
    const fields = line.split(";").map(part => {
      const match = part.trim().match(/^([A-Z][A-Z ]*):\s*([\s\S]*)$/i);
      return match ? [match[1].trim().toUpperCase(), match[2].trim()] : null;
    }).filter(Boolean);
    const data = Object.fromEntries(fields);
    if (!data.INVOICE) return false;

    const card = document.createElement("section");
    card.className = "assistant-invoice-card";
    const header = document.createElement("div");
    header.className = "assistant-invoice-head";
    const title = document.createElement("h3");
    title.textContent = data.INVOICE;
    header.appendChild(title);
    if (data.RISK) {
      const risk = document.createElement("span");
      risk.className = "assistant-risk-pill " + data.RISK.toUpperCase();
      risk.textContent = data.RISK.toUpperCase() + " RISK";
      header.appendChild(risk);
    }
    card.appendChild(header);
    if (data.CUSTOMER) {
      const customer = document.createElement("p");
      customer.className = "assistant-invoice-customer";
      customer.textContent = data.CUSTOMER;
      card.appendChild(customer);
    }
    const factGrid = document.createElement("div");
    factGrid.className = "assistant-invoice-facts";
    ["AMOUNT", "STATUS", "DUE DATE", "TIMING"].forEach(key => {
      if (!data[key]) return;
      const fact = document.createElement("div");
      fact.className = "assistant-invoice-fact";
      const label = document.createElement("span");
      label.textContent = key;
      const value = document.createElement("strong");
      value.textContent = data[key];
      fact.append(label, value);
      factGrid.appendChild(fact);
    });
    if (factGrid.childElementCount) card.appendChild(factGrid);
    ["EVIDENCE", "NEXT ACTION"].forEach(key => {
      if (!data[key]) return;
      const section = document.createElement("div");
      section.className = key === "NEXT ACTION" ? "assistant-invoice-action" : "assistant-invoice-evidence";
      const label = document.createElement("strong");
      label.textContent = key === "NEXT ACTION" ? "Recommended next action" : "Evidence";
      const copy = document.createElement("div");
      appendInline(copy, data[key]);
      section.append(label, copy);
      card.appendChild(section);
    });
    const actionControls = createInvoiceActionControls(data.INVOICE);
    if (actionControls) card.appendChild(actionControls);
    container.appendChild(card);
    return true;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^\x60{3}/.test(line)) {
      flushList();
      if (codeLines) flushCode(); else codeLines = [];
      continue;
    }
    if (codeLines) { codeLines.push(rawLine); continue; }
    if (!line) { flushList(); continue; }
    if (/^INVOICE\s*:/i.test(line) && renderInvoiceCard(line)) { flushList(); continue; }
    if (/^[-*_]{3,}$/.test(line)) { flushList(); container.appendChild(document.createElement("hr")); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { flushList(); addBlock("h" + (heading[1].length + 1), heading[2], "ai-answer-heading"); continue; }
    if (/^Prioritized\s+Merchant\s+Actions\s*:?$/i.test(line)) {
      flushList(); addBlock("h3", "Prioritized Merchant Actions", "ai-answer-heading"); continue;
    }
    const bullet = line.match(/^(?:[-*•])\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      const type = bullet ? "ul" : "ol";
      if (!list || listType !== type) { flushList(); list = document.createElement(type); listType = type; }
      const item = document.createElement("li"); appendInline(item, (bullet || numbered)[1]); list.appendChild(item); continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushList(); addBlock("blockquote", quote[1], "ai-answer-quote"); continue; }
    flushList(); addBlock("p", line, "");
  }
  flushList();
  flushCode();

  // Attach real actions for any live invoice IDs mentioned by the AI,
  // even when the provider returns prose instead of the preferred invoice-card format.
  const mentionedInvoices = invoices.filter(invoice => {
    const id = String(invoice.id || "");
    if (!id) return false;
    const answerText = String(answer || "");
    let position = answerText.toLowerCase().indexOf(id.toLowerCase());
    while (position >= 0) {
      const before = position > 0 ? answerText[position - 1] : "";
      const afterIndex = position + id.length;
      const after = afterIndex < answerText.length ? answerText[afterIndex] : "";
      const isBoundary = char => !char || !/[A-Z0-9_-]/i.test(char);
      if (isBoundary(before) && isBoundary(after)) return true;
      position = answerText.toLowerCase().indexOf(id.toLowerCase(), position + 1);
    }
    return false;
  });
  const alreadyAttached = new Set(
    [...container.querySelectorAll(".assistant-invoice-head h3")].map(node => node.textContent.trim())
  );
  const remainingInvoices = mentionedInvoices.filter(invoice => !alreadyAttached.has(String(invoice.id)));
  if (remainingInvoices.length) {
    const actionPanel = document.createElement("section");
    actionPanel.className = "assistant-mentioned-actions";
    const heading = document.createElement("h3");
    heading.textContent = "Available actions";
    actionPanel.appendChild(heading);
    remainingInvoices.forEach(invoice => {
      const row = document.createElement("div");
      row.className = "assistant-mentioned-action-row";
      const label = document.createElement("strong");
      label.textContent = String(invoice.id) + " · " + String(invoice.customer || "Customer");
      row.appendChild(label);
      const controls = createInvoiceActionControls(invoice.id);
      if (controls) row.appendChild(controls);
      actionPanel.appendChild(row);
    });
    container.appendChild(actionPanel);
  }
  if (provider) {
    const meta = document.createElement("div"); meta.className = "ai-answer-provider";
    meta.textContent = "AI provider · " + provider; container.appendChild(meta);
  }
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
  responseBox.classList.remove("ai-response-rich");
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
    if (data.answer) renderAssistantAnswer(responseBox, data.answer, data.provider);
    else if (data.summary) renderAssistantAnswer(responseBox, (data.error || "AI is temporarily unavailable.") + "\n\n**Current invoice snapshot**\n\n```json\n" + JSON.stringify(data.summary, null, 2) + "\n```");
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


$("#invoiceSearch").addEventListener("input", () => { invoicePage = 1; renderInvoices(); });
$("#invoiceStatusFilter").addEventListener("change", () => { invoicePage = 1; renderInvoices(); });
$("#invoiceDateFrom").addEventListener("change", () => { invoicePage = 1; renderInvoices(); });
$("#invoiceDateTo").addEventListener("change", () => { invoicePage = 1; renderInvoices(); });
$("#invoicePrevPage").addEventListener("click", () => { if (invoicePage > 1) { invoicePage--; renderInvoices(); } });
$("#invoiceNextPage").addEventListener("click", () => { invoicePage++; renderInvoices(); });
$("#monthlyRange").addEventListener("change", refreshMonthlyAnalytics);

$("#showCreateInvoiceButton").addEventListener("click", () => {
  $("#createInvoiceForm").hidden = false;
  $("#showCreateInvoiceButton").hidden = true;
  $("#cancelEditButton").hidden = false;
  $("#createInvoiceForm").scrollIntoView({ behavior: "smooth", block: "center" });
});

$("#cancelEditButton").addEventListener("click", () => {
  $("#createInvoiceForm").reset();
  $("#invoiceItemRows").innerHTML = "";
  addInvoiceItemRow();
  $("#editingInvoiceId").value = "";
  $("#createInvoiceButton").textContent = "Create invoice";
  $("#cancelEditButton").hidden = true;
  $("#createInvoiceForm").hidden = true;
  $("#showCreateInvoiceButton").hidden = false;
  $("#invoiceTaxRate").value = "0";
  updateInvoiceItemsTotal();
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
  const payload = { customer: formData.get("customer"), email: formData.get("email"), amount: formData.get("amount"), taxRate: formData.get("taxRate") || "0", dueDate: formData.get("dueDate"), lineItems: collectInvoiceItems() };
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
    $("#invoiceItemRows").innerHTML = "";
    addInvoiceItemRow();
    $("#editingInvoiceId").value = "";
    $("#createInvoiceButton").textContent = "Create invoice";
    $("#cancelEditButton").hidden = true;
    $("#createInvoiceForm").hidden = true;
    $("#showCreateInvoiceButton").hidden = false;
    $("#invoiceTaxRate").value = "0";
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

$("#addInvoiceItemButton").addEventListener("click", () => addInvoiceItemRow());
$("#invoiceTaxRate").addEventListener("input", updateInvoiceItemsTotal);
addInvoiceItemRow();
updateInvoiceItemsTotal();

loadMerchantProfile().catch(error => console.error("Merchant profile loading failed:", error));
refreshDashboard().catch(error => console.error(error));
loadPayPalSdk().catch(error => console.error(error));
$('#exportInvoicesButton').addEventListener('click', exportInvoicesCSV);
$('#exportPaymentsButton').addEventListener('click', exportPaymentsCSV);


async function initializeWorkspaceAccess() {
  try {
    const response = await fetch("/api/session", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) {
      window.location.replace("/login");
      return;
    }
    const session = await response.json();
    const roleLabel = session.role === "judge" ? "Judge Demo" : "Administrator";
    const roleElement = document.getElementById("workspaceRole");
    if (roleElement) roleElement.textContent = roleLabel;
    if (session.role === "judge") {
      const demoNotice = document.createElement("div");
      demoNotice.className = "judge-demo-data-notice";
      demoNotice.textContent = "DEMO DATA · Includes illustrative historical PAID invoice statuses for dashboard and AI demonstrations. These sample records are not PayPal captures; only real Sandbox payments appear in payment history.";
      const main = document.querySelector(".main");
      const topbar = document.querySelector(".topbar");
      if (main && topbar) main.insertBefore(demoNotice, topbar.nextSibling);
      const merchantPanel = document.querySelector(".merchant-profile-panel");
      if (merchantPanel) merchantPanel.hidden = true;
      const eyebrow = document.querySelector(".topbar .eyebrow");
      if (eyebrow) eyebrow.textContent = "JUDGE DEMO · SANDBOX WORKSPACE";
      const heading = document.querySelector(".topbar h1");
      if (heading) heading.innerHTML = 'Explore SmartPay AI <span>✦</span>';
    }
    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      try {
        await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
      } finally {
        window.location.replace("/login");
      }
    });
  } catch (_) {
    window.location.replace("/login");
  }
}
initializeWorkspaceAccess();
