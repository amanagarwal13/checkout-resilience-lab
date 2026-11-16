import type { Context, Next } from "hono";

// Spending guards for the public demo: every stress test, fix and AI message
// costs OpenAI tokens and PayPal sandbox calls. Limits are per visitor per hour
// and for the whole service per day, both in memory.

interface Bucket { count: number; resetAt: number }
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function visitor(c: Context) {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
}

export function limit(name: string, perVisitorPerHour: number, perDay: number) {
  const visitors = new Map<string, Bucket>();
  const day: Bucket = { count: 0, resetAt: Date.now() + DAY };

  return async (c: Context, next: Next) => {
    const now = Date.now();
    if (now > day.resetAt) Object.assign(day, { count: 0, resetAt: now + DAY });
    const key = visitor(c);
    const mine = visitors.get(key);
    const bucket = mine && now < mine.resetAt ? mine : { count: 0, resetAt: now + HOUR };
    visitors.set(key, bucket);

    if (day.count >= perDay) {
      return c.json({ error: `The demo has reached today's limit for ${name}. Recorded runs are still available.` }, 429);
    }
    if (bucket.count >= perVisitorPerHour) {
      const minutes = Math.ceil((bucket.resetAt - now) / 60_000);
      return c.json({ error: `You've reached the limit for ${name}. Try again in ${minutes} minutes.` }, 429);
    }
    bucket.count++;
    day.count++;
    await next();
  };
}

export const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
