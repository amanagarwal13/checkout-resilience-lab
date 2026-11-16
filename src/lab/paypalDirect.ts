import { PAYPAL_SANDBOX_API, config } from "../config.js";

// Resilience Lab's own view of the money: straight from PayPal, never through the proxy
// or the store, so a buggy store can't hide anything.
async function token(): Promise<string> {
  const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString("base64");
  const res = await fetch(`${PAYPAL_SANDBOX_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token request failed (${res.status})`);
  return (await res.json()).access_token;
}

export interface PayPalMoney {
  orderStatus: string;
  captures: { id: string; amount: string; status: string }[];
  refunds: { id: string; amount: string; status: string; createdAt: string }[];
}

export async function moneyForOrder(orderId: string): Promise<PayPalMoney> {
  const res = await fetch(`${PAYPAL_SANDBOX_API}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`Couldn't read order ${orderId} from PayPal (${res.status})`);
  const order = await res.json();
  const payments = order.purchase_units?.[0]?.payments ?? {};
  return {
    orderStatus: order.status,
    captures: (payments.captures ?? []).map((c: any) => ({ id: c.id, amount: c.amount?.value, status: c.status })),
    refunds: (payments.refunds ?? []).map((r: any) => ({ id: r.id, amount: r.amount?.value, status: r.status, createdAt: r.create_time })),
  };
}
