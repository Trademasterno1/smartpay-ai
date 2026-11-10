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
}

async function startPayPalCheckout(invoiceId) {
  const button = document.querySelector(`[data-invoice="${invoiceId}"]`);
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Loading…";
  try {
    const response = await fetch("/api/paypal/create-order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId })
    });
    const order = await response.json();
    if (!response.ok) throw new Error(order.error || "Unable to start PayPal checkout.");
    if (!window.paypal || !window.paypal.Buttons) throw new Error("PayPal checkout SDK is not ready. Refresh and try again.");
    await window.paypal.Buttons({
      createOrder: (_data, actions) => actions.order.create({}),
      onApprove: async (_data, actions) => {
        const details = await actions.order.capture();
        const captured = await fetch("/api/paypal/capture-order", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: order.id })
        });
        const result = await captured.json();
        if (!captured.ok) throw new Error(result.error || "Capture failed.");
        $("#aiResponse").textContent = "Payment completed in PayPal Sandbox. Invoice " + invoiceId + " status: " + result.status + ".";
        await refreshDashboard();
      },
      onError: error => { $("#aiResponse").textContent = "PayPal checkout error: " + error.message; }
    }).render("#paypal-checkout-placeholder");
    $("#aiResponse").textContent = "PayPal checkout is ready. The demo checkout will open in the PayPal flow.";
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
  responseBox.textContent = "Thinking…";
  try {
    const response = await fetch("/api/ai/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    const data = await response.json();
    if (data.answer) responseBox.textContent = data.answer;
    else if (data.summary) responseBox.textContent = data.error + "\n\nCurrent invoice snapshot:\n" + JSON.stringify(data.summary, null, 2);
    else responseBox.textContent = data.error || "Something went wrong.";
  } catch (_error) {
    responseBox.textContent = "Unable to reach the assistant. Check that the server is running.";
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