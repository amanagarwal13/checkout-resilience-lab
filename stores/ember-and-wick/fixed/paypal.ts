import axios, { type AxiosAdapter } from "axios";
import { Client, Environment, OrdersController, PaymentsController } from "@paypal/paypal-server-sdk";

const PAYPAL_SANDBOX_API = "https://api-m.sandbox.paypal.com";

export interface PayPalOptions {
  clientId: string;
  clientSecret: string;
  // Optional: send every SDK request to this base URL instead of PayPal's
  // sandbox. This is the one setting DummyRun needs to sit in between.
  apiBase?: string;
}

function redirectingAdapter(apiBase: string): AxiosAdapter {
  const httpAdapter = axios.getAdapter("http");
  return (requestConfig) => {
    if (requestConfig.url?.startsWith(PAYPAL_SANDBOX_API)) {
      requestConfig.url = apiBase + requestConfig.url.slice(PAYPAL_SANDBOX_API.length);
    }
    return httpAdapter(requestConfig);
  };
}

export function createPayPal({ clientId, clientSecret, apiBase }: PayPalOptions) {
  const client = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
    environment: Environment.Sandbox,
    timeout: 30_000,
    ...(apiBase ? { unstable_httpClientOptions: { adapter: redirectingAdapter(apiBase) } } : {}),
  });
  return { orders: new OrdersController(client), payments: new PaymentsController(client) };
}

export function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /abort|timeout|timed out/i.test(`${error.name} ${error.message}`);
}
