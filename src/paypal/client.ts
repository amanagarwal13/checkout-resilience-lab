import axios, { type AxiosAdapter } from "axios";
import {
  Client,
  Environment,
  OrdersController,
  PaymentsController,
} from "@paypal/paypal-server-sdk";
import { PAYPAL_SANDBOX_API } from "../config.js";

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  // When set, every SDK request goes to this base URL instead of PayPal's sandbox.
  // DummyRun uses it to sit between a store and PayPal.
  apiBase?: string;
}

// The SDK hard-codes PayPal's hosts, but passes `unstable_httpClientOptions`
// straight to axios. A custom adapter rewrites the host and hands the request
// to axios's normal HTTP adapter, so nothing else about the SDK changes.
function redirectingAdapter(apiBase: string): AxiosAdapter {
  const httpAdapter = axios.getAdapter("http");
  return (requestConfig) => {
    if (requestConfig.url?.startsWith(PAYPAL_SANDBOX_API)) {
      requestConfig.url = apiBase + requestConfig.url.slice(PAYPAL_SANDBOX_API.length);
    }
    return httpAdapter(requestConfig);
  };
}

export function createPayPal({ clientId, clientSecret, apiBase }: PayPalClientOptions) {
  const client = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
    environment: Environment.Sandbox,
    timeout: 30_000,
    ...(apiBase ? { unstable_httpClientOptions: { adapter: redirectingAdapter(apiBase) } } : {}),
  });
  return {
    orders: new OrdersController(client),
    payments: new PaymentsController(client),
  };
}

export type PayPal = ReturnType<typeof createPayPal>;

export function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /abort|timeout|timed out/i.test(`${error.name} ${error.message}`);
}
