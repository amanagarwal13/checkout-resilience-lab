// DummyRun's one line for stores that use PayPal's Server SDK (@paypal/paypal-server-sdk):
//
//   import { dummyrun } from "./dummyrun-paypal.js";
//   const client = new Client({ ...yourOptions, ...dummyrun() });
//
// When DUMMYRUN_PAYPAL_API is set (DummyRun sets it while crash-testing), every SDK
// request goes to DummyRun, which forwards it to PayPal's sandbox and injects the
// faults the test needs. When it isn't set, this returns {} and changes nothing.
// Sandbox only: requests to PayPal's live API are never redirected.

import axios from "axios";

const PAYPAL_SANDBOX_API = "https://api-m.sandbox.paypal.com";

/** @returns {{ unstable_httpClientOptions?: { adapter: import("axios").AxiosAdapter } }} */
export function dummyrun(apiBase = process.env.DUMMYRUN_PAYPAL_API) {
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
