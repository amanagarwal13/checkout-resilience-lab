import { existsSync } from "node:fs";

// Locally the keys come from .env; on Render they are environment variables.
if (existsSync(".env")) process.loadEnvFile(".env");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

export const PAYPAL_SANDBOX_API = "https://api-m.sandbox.paypal.com";

export const config = {
  paypalClientId: required("PAYPAL_CLIENT_ID"),
  paypalClientSecret: required("PAYPAL_CLIENT_SECRET"),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  openaiInvestigatorModel: process.env.OPENAI_INVESTIGATOR_MODEL ?? "gpt-5.5",
};
