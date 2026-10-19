import { chromium } from "playwright";
import { buyItems, requestRefund, viewShop } from "./shopper/browserTools.js";

// Scripted (no AI) end-to-end check: buy by card, then refund one item.
const storeUrl = process.argv[2] ?? "http://localhost:4100";
const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("  [browser]", m.text()); });
try {
  console.log("shop:", await viewShop(page, storeUrl));
  const order = await buyItems(page, storeUrl, [{ sku: "cedar-ember", quantity: 1 }, { sku: "midnight-amber", quantity: 1 }]);
  console.log("bought:", order);
  console.log("refund:", await requestRefund(page, storeUrl, order.orderId, "midnight-amber", "Arrived cracked"));
} finally {
  await browser.close();
}
