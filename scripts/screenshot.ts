import { chromium } from "playwright";

// Full-page screenshots of the lab UI for design review.
// Usage: npx tsx scripts/screenshot.ts <url> <out.png> [width] [height]
const [url = "http://localhost:3000", out = "screenshot.png", width = "1280", height = "900"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}] ${m.text().slice(0, 400)}`); });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 600)}`));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(Number(process.env.WAIT_MS ?? 1500));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`saved ${out}`);
