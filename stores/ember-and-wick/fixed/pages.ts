import { catalog } from "./catalog.js";
import type { StoreOrder } from "./app.js";

const styles = `
  :root { --ink:#2b2420; --muted:#7a6e66; --line:#e8e1da; --bg:#fbf8f5; --accent:#9a4a1e; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Georgia, "Times New Roman", serif; color:var(--ink); background:var(--bg); }
  header { padding:20px 24px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:baseline; }
  header h1 { margin:0; font-size:22px; font-weight:normal; letter-spacing:.02em; }
  header span { color:var(--muted); font:13px system-ui, sans-serif; }
  main { max-width:760px; margin:0 auto; padding:24px; font-family: system-ui, sans-serif; }
  .products { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px; }
  .card h2 { margin:0 0 4px; font:500 17px Georgia, serif; }
  .card p { margin:0 0 10px; color:var(--muted); font-size:14px; }
  .price { font-weight:600; }
  input[type=number] { width:64px; padding:6px; border:1px solid var(--line); border-radius:8px; }
  input[type=text] { width:100%; padding:8px; border:1px solid var(--line); border-radius:8px; }
  button { padding:10px 16px; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; font-size:15px; }
  button.secondary { background:#fff; color:var(--accent); }
  #checkout { display:none; margin-top:20px; }
  .field { margin-bottom:8px; }
  .notice { margin-top:12px; font-size:14px; }
  .error { color:#a12a2a; } .ok { color:#2f6b2f; }
  table { width:100%; border-collapse:collapse; } td { padding:10px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
`;

function layout(title: string, body: string, head = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${styles}</style>${head}</head>
<body><header><h1>Ember and Wick</h1><span>Hand-poured candles</span></header><main>${body}</main></body></html>`;
}

export function shopPage({ clientId }: { clientId: string }) {
  const products = catalog
    .map(
      (p) => `<div class="card" data-sku="${p.sku}" data-price="${p.price}">
  <h2>${p.name}</h2><p>${p.description}</p>
  <div style="display:flex;justify-content:space-between;align-items:center">
    <span class="price">$${p.price}</span>
    <label>Qty <input type="number" min="0" max="10" value="0" name="qty-${p.sku}" aria-label="Quantity of ${p.name}"></label>
  </div></div>`,
    )
    .join("");

  const sdk = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&components=buttons,card-fields&currency=USD&intent=capture`;

  return layout(
    "Ember and Wick",
    `<section class="products">${products}</section>
<div style="margin-top:20px"><button id="go-to-checkout">Checkout</button></div>
<section id="checkout" class="card">
  <h2>Pay by card</h2>
  <div id="card-name" class="field"></div>
  <div id="card-number" class="field"></div>
  <div style="display:flex;gap:8px"><div id="card-expiry" class="field" style="flex:1"></div><div id="card-cvv" class="field" style="flex:1"></div></div>
  <button id="pay-with-card">Pay</button>
  <p style="margin:16px 0 8px;color:var(--muted)">Or pay with PayPal</p>
  <div id="paypal-button"></div>
  <p id="checkout-message" class="notice" role="status"></p>
</section>
<script src="${sdk}"></script>
<script>
  // One checkout ID per visit: a double-submitted payment reuses the same PayPal order.
  const checkoutId = crypto.randomUUID();
  const message = document.getElementById("checkout-message");
  const payButton = document.getElementById("pay-with-card");
  function cart() {
    return [...document.querySelectorAll("[data-sku]")].map((el) => ({
      sku: el.dataset.sku,
      price: el.dataset.price,
      quantity: Number(el.querySelector("input").value || 0),
    }));
  }
  async function readJson(res) {
    try { return await res.json(); } catch { return { error: "Something went wrong (" + res.status + ")" }; }
  }
  async function createOrder() {
    const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: cart(), checkoutId }) });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error || "Could not start checkout");
    return data.id;
  }
  async function onApprove(data) {
    message.className = "notice"; message.textContent = "Confirming your payment…";
    const res = await fetch("/api/orders/" + data.orderID + "/capture", { method: "POST" });
    const result = await readJson(res);
    if (!res.ok) { showError(result.error); return; }
    location.href = "/orders/" + result.id;
  }
  function showError(text) {
    message.className = "notice error"; message.textContent = text;
    payButton.disabled = false;
  }
  function onError(err) { showError("Payment failed: " + (err && err.message ? err.message : err)); }

  document.getElementById("go-to-checkout").addEventListener("click", () => {
    document.getElementById("checkout").style.display = "block";
  });

  const cardFields = paypal.CardFields({ createOrder, onApprove, onError });
  if (cardFields.isEligible()) {
    cardFields.NameField().render("#card-name");
    cardFields.NumberField().render("#card-number");
    cardFields.ExpiryField().render("#card-expiry");
    cardFields.CVVField().render("#card-cvv");
    payButton.addEventListener("click", () => {
      // One payment at a time: a double-click can't start a second payment.
      if (payButton.disabled) return;
      payButton.disabled = true;
      message.className = "notice"; message.textContent = "Processing…";
      cardFields.submit().catch(onError);
    });
  } else {
    payButton.disabled = true;
    message.textContent = "Card payments aren't available for this store.";
  }
  paypal.Buttons({ createOrder, onApprove, onError }).render("#paypal-button");
</script>`,
  );
}

export function orderPage(order: StoreOrder) {
  const rows = order.items
    .map(
      (i) => `<tr data-sku="${i.sku}">
  <td><strong>${i.name}</strong><br><span style="color:var(--muted)">${i.quantity} × $${i.price}</span></td>
  <td style="width:55%">
    <input type="text" name="reason-${i.sku}" placeholder="What went wrong?" aria-label="Problem with ${i.name}">
    <div style="margin-top:6px"><button class="secondary" data-refund="${i.sku}">Request refund</button></div>
    <p class="notice" id="refund-result-${i.sku}" role="status"></p>
  </td></tr>`,
    )
    .join("");

  return layout(
    `Order ${order.id}`,
    `<h2 style="font:500 20px Georgia,serif;margin:0 0 4px">Thanks for your order</h2>
<p style="color:var(--muted);margin:0 0 16px">Order <span id="order-id">${order.id}</span> · $${order.total} paid</p>
<div class="card"><p style="margin:0 0 8px">Something arrive damaged? Request a refund for that item.</p><table>${rows}</table></div>
<div class="card" style="margin-top:16px">
  <h2 style="font:500 17px Georgia,serif;margin:0 0 8px">Chat with support</h2>
  <div id="support-log" style="max-height:260px;overflow:auto;font-size:14px;margin-bottom:8px"></div>
  <div style="display:flex;gap:8px">
    <input type="text" id="support-input" placeholder="How can we help?" aria-label="Message to support">
    <button id="support-send">Send</button>
  </div>
</div>
<script>
  const log = document.getElementById("support-log");
  function addLine(who, text) {
    const p = document.createElement("p");
    p.style.margin = "0 0 6px";
    p.dataset.who = who;
    p.innerHTML = "<strong></strong> ";
    p.firstChild.textContent = who === "you" ? "You:" : "Support:";
    p.append(text);
    log.append(p);
    log.scrollTop = log.scrollHeight;
  }
  document.getElementById("support-send").addEventListener("click", async () => {
    const input = document.getElementById("support-input");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    addLine("you", message);
    const res = await fetch("/api/orders/${order.id}/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    const data = await res.json();
    addLine("support", data.reply || data.error);
  });
</script>
<script>
  document.querySelectorAll("[data-refund]").forEach((btn) => btn.addEventListener("click", async () => {
    const sku = btn.dataset.refund;
    const out = document.getElementById("refund-result-" + sku);
    out.className = "notice"; out.textContent = "Requesting refund…";
    const reason = document.querySelector('[name="reason-' + sku + '"]').value;
    try {
      const res = await fetch("/api/orders/${order.id}/refunds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku, reason }) });
      const data = await res.json();
      if (res.ok) { out.className = "notice ok"; out.textContent = "Refund of $" + data.amount + " issued (" + data.refundId + ")"; }
      else { out.className = "notice error"; out.textContent = data.error; }
    } catch (e) { out.className = "notice error"; out.textContent = "Network error. Please try again."; }
  }));
</script>`,
  );
}
