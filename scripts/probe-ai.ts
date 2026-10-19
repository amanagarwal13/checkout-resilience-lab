import { chromium } from "playwright";

// Opens the dashboard, finds Studio's AI chat, asks a question and saves the conversation.
// Usage: npx tsx scripts/probe-ai.ts <out.png> ["prompt"]
const [out = "ai.png", prompt] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 400)}`));
await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const buttons = await page.$$eval("button, [role=button]", (els) =>
  els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim()).filter(Boolean).slice(0, 60),
);
console.log("buttons:", JSON.stringify(buttons));

if (prompt) {
  await page.click('button:has-text("Ask AI and edit")');
  await page.waitForTimeout(2500);
  const after = await page.$$eval("button, [role=button], textarea", (els) =>
    els.map((e) => (e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.textContent || "").trim()).filter(Boolean).slice(0, 80),
  );
  console.log("edit mode controls:", JSON.stringify(after));
  const box = page.locator("textarea, [contenteditable=true]").last();
  await box.fill(prompt);
  await box.press("Enter");
  await page.waitForTimeout(Number(process.env.WAIT_MS ?? 90_000));
  const panel = await page.locator("body").innerText();
  const start = panel.lastIndexOf(prompt.slice(0, 30));
  console.log("--- conversation ---\n" + panel.slice(Math.max(0, start), start + 3000));
}
await page.screenshot({ path: out });
await browser.close();
