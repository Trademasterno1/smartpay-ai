(() => {
  const $ = selector => document.querySelector(selector);
  const token = window.location.pathname.split("/").filter(Boolean).pop();
  const money = (value, currency) => new Intl.NumberFormat("en-US", {style:"currency",currency}).format(Number(value));
  const setMessage = (message, kind = "") => { const el=$("#message"); el.textContent=message; el.className="status"+(kind?" "+kind:""); };
  const safeText = (selector, value) => { $(selector).textContent = value || ""; };
  let invoice = null;

  function render(data) {
    invoice = data;
    const merchant = data.merchantProfile || {};
    $("#merchant").innerHTML = "";
    const name = document.createElement("strong"); name.textContent = merchant.businessName || "Merchant";
    $("#merchant").appendChild(name);
    [merchant.address, merchant.email, merchant.phone, merchant.taxNumber ? "TRN: "+merchant.taxNumber : ""].filter(Boolean).forEach(value => {
      const p=document.createElement("p"); p.textContent=value; $("#merchant").appendChild(p);
    });
    safeText("#invoiceId", data.id);
    safeText("#dueDate", "Due "+data.dueDate);
    const items = Array.isArray(data.lineItems)&&data.lineItems.length?data.lineItems:[{description:"Invoice total",quantity:1,unitPrice:data.amount,lineTotal:data.amount}];
    const subtotal = items.reduce((sum,item)=>sum+Number(item.quantity)*Number(item.unitPrice),0);
    const taxRate = Number(data.taxRate||0);
    const taxAmount = Math.max(0,Number(data.amount)-subtotal);
    safeText("#subtotal", money(subtotal,data.currency));
    safeText("#taxRate", String(taxRate));
    safeText("#taxAmount", money(taxAmount,data.currency));
    safeText("#amount", money(data.amount,data.currency));
    const rows=$("#lineItems"); rows.innerHTML="";
    items.forEach(item=>{
      const tr=document.createElement("tr");
      [item.description, String(item.quantity), money(item.unitPrice,data.currency), money(item.lineTotal,data.currency)].forEach(value=>{const td=document.createElement("td");td.textContent=value;tr.appendChild(td);});
      rows.appendChild(tr);
    });
    const paid=data.status==="PAID";
    $("#payButton").disabled=paid;
    $("#payButton").textContent=paid?"Invoice already paid":"Continue to PayPal";
    if(paid) setMessage("Payment received. This invoice is marked as PAID.","success");
    else setMessage("Please check the invoice details before continuing to PayPal.");
  }

  async function loadInvoice() {
    if(!token) throw new Error("Invoice link is incomplete.");
    const response=await fetch("/api/public-invoices/"+encodeURIComponent(token),{cache:"no-store"});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||"This invoice link is unavailable.");
    render(data);
  }

  async function finishPayment(orderId) {
    setMessage("Verifying your PayPal payment…");
    const response=await fetch("/api/public-invoices/"+encodeURIComponent(token)+"/capture",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId})
    });
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||"Payment could not be verified.");
    await loadInvoice();
    setMessage("Payment confirmed. Thank you — your invoice is now paid.","success");
  }

  $("#payButton").addEventListener("click",async()=>{
    const button=$("#payButton"); button.disabled=true; button.textContent="Connecting to PayPal…";
    try{
      const response=await fetch("/api/public-invoices/"+encodeURIComponent(token)+"/create-order",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||"Could not start PayPal checkout.");
      if(!data.approvalUrl || !data.approvalUrl.startsWith("https://")) throw new Error("PayPal returned an invalid approval link.");
      window.location.assign(data.approvalUrl);
    }catch(error){setMessage(error.message,"error");button.disabled=false;button.textContent="Try PayPal again";}
  });

  (async()=>{
    try{
      await loadInvoice();
      const params=new URLSearchParams(window.location.search);
      if(params.get("payment")==="success"){
        const paypalOrderId=params.get("token");
        if(!paypalOrderId) throw new Error("PayPal did not return a payment reference.");
        await finishPayment(paypalOrderId);
        history.replaceState({}, "", window.location.pathname);
      }else if(params.get("payment")==="cancelled"){
        setMessage("Checkout was cancelled. No payment was captured.");
        history.replaceState({}, "", window.location.pathname);
      }
    }catch(error){setMessage(error.message,"error");$("#payButton").disabled=true;}
  })();
})();