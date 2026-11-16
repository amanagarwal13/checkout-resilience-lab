// Resilience Lab's one line for stores that use PayPal's Server SDK (@paypal/paypal-server-sdk):
//
//   import { resilienceLab } from "./resilience-lab-paypal.js";
//   const client = new Client({ ...yourOptions, ...resilienceLab() });
//
// When RESILIENCE_LAB_PAYPAL_API is set (Resilience Lab sets it while stress-testing), every SDK
// request goes to Resilience Lab, which forwards it to PayPal's sandbox and injects the
// faults the test needs. When it isn't set, this returns {} and changes nothing.
// Sandbox only: requests to PayPal's live API are never redirected.

import axios from "axios";

const PAYPAL_SANDBOX_API = "https://api-m.sandbox.paypal.com";

/** @returns {{ unstable_httpClientOptions?: { adapter: import("axios").AxiosAdapter } }} */
export function resilienceLab(apiBase = process.env.RESILIENCE_LAB_PAYPAL_API) {
  if (!apiBase) return {};
  const http = axios.getAdapter("http");
  return {
    unstable_httpClientOptions: {
      adapter: (request) => {
        if (request.url?.startsWith(PAYPAL_SANDBOX_API)) request.url = apiBase + request.url.slice(PAYPAL_SANDBOX_API.length);
        return http(request);
      },
    },
  };
}
