import type { Frame, Page } from "playwright";

// PayPal's published sandbox test Visa. No PayPal login, no one-time code.
const TEST_CARD = { name: "Test Buyer", number: "4111111111111111", expiry: "12/30", cvv: "123" };

export interface ShopItem { sku: string; name: string; price: string }

export async function viewShop(page: Page, storeUrl: string): Promise<ShopItem[]> {
  await page.goto(storeUrl, { waitUntil: "domcontentloaded" });
  return page.$$eval("[data-sku]", (cards) =>
    cards.map((card) => ({
      sku: (card as HTMLElement).dataset.sku ?? "",
      name: card.querySelector("h2")?.textContent?.trim() ?? "",
      price: card.querySelector(".price")?.textContent?.trim() ?? "",
    })),
  );
}

async function cardFrame(page: Page, kind: "name" | "number" | "expiry" | "cvv"): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const element = await frame.frameElement().catch(() => null);
      const title = (await element?.getAttribute("title").catch(() => null)) ?? "";
      if (title.toLowerCase().includes(`card_${kind}`)) return frame;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`PayPal's ${kind} card field never appeared`);
}

// PayPal's card fields reformat input as you type (for example "12 / 30"),
// so compare digits and retype if a keystroke got lost.
async function fillCardField(page: Page, kind: "name" | "number" | "expiry" | "cvv", value: string) {
  const want = kind === "name" ? value : value.replace(/\D/g, "");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const input = (await cardFrame(page, kind)).locator("input").first();
    await input.click();
    await input.fill("");
    await input.pressSequentially(kind === "name" ? value : want, { delay: 40 });
    const typed = await input.inputValue();
    if ((kind === "name" ? typed : typed.replace(/\D/g, "")) === want) return;
  }
  throw new Error(`Couldn't enter the card ${kind} reliably`);
}

// How a test shopper misbehaves at checkout. Set by the scenario, not the AI,
// so every run does the same thing.
export interface CheckoutBehaviour {
  doubleClickPay?: boolean;
  tamperPrices?: boolean; // rewrite every price in the cart request to $0.01
}

export async function buyItems(page: Page, storeUrl: string, items: { sku: string; quantity: number }[], behaviour: CheckoutBehaviour = {}) {
  if (!page.url().startsWith(storeUrl) || page.url().includes("/orders/")) {
    await page.goto(storeUrl, { waitUntil: "domcontentloaded" });
  }
  if (behaviour.tamperPrices) {
    await page.route("**/api/orders", async (route) => {
      const body = route.request().postDataJSON();
      body.items = body.items.map((i: { price?: string }) => ({ ...i, price: "0.01" }));
      await route.continue({ postData: JSON.stringify(body) });
    });
  }
  for (const item of items) {
    await page.fill(`[name="qty-${item.sku}"]`, String(item.quantity));
  }
  await page.click("#go-to-checkout");

  for (const [kind, value] of [["name", TEST_CARD.name], ["number", TEST_CARD.number], ["expiry", TEST_CARD.expiry], ["cvv", TEST_CARD.cvv]] as const) {
    await fillCardField(page, kind, value);
  }
  await page.click("#pay-with-card");
  if (behaviour.doubleClickPay) {
    await page.waitForTimeout(150);
    await page.click("#pay-with-card", { force: true }).catch(() => {});
  }

  try {
    await page.waitForURL(/\/orders\//, { timeout: 60_000 });
  } catch {
    const message = await page.textContent("#checkout-message").catch(() => "");
    throw new Error(`Checkout didn't finish. Page says: ${message || "nothing"}`);
  }
  const orderId = (await page.textContent("#order-id"))?.trim() ?? "";
  const summary = (await page.textContent("main p"))?.trim() ?? "";
  return { orderId, summary };
}

export async function chatWithSupport(page: Page, storeUrl: string, orderId: string, message: string) {
  const orderUrl = `${storeUrl}/orders/${orderId}`;
  if (!page.url().startsWith(orderUrl)) await page.goto(orderUrl, { waitUntil: "domcontentloaded" });
  const replies = page.locator('#support-log [data-who="support"]');
  const before = await replies.count();
  await page.fill("#support-input", message);
  await page.click("#support-send");
  await replies.nth(before).waitFor({ timeout: 90_000 });
  return ((await replies.nth(before).textContent()) ?? "").replace(/^Support:\s*/, "").trim();
}

export async function requestRefund(page: Page, storeUrl: string, orderId: string, sku: string, reason: string) {
  const orderUrl = `${storeUrl}/orders/${orderId}`;
  if (!page.url().startsWith(orderUrl)) await page.goto(orderUrl, { waitUntil: "domcontentloaded" });
  await page.fill(`[name="reason-${sku}"]`, reason);
  const result = page.locator(`#refund-result-${sku}`);
  await result.evaluate((el) => (el.textContent = ""));
  await page.click(`[data-refund="${sku}"]`);
  await page.waitForFunction(
    (id) => {
      const text = document.getElementById(id)?.textContent ?? "";
      return text !== "" && !text.startsWith("Requesting");
    },
    `refund-result-${sku}`,
    { timeout: 60_000 },
  );
  return (await result.textContent())?.trim() ?? "";
}
