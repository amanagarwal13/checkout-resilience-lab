import type { AxiosAdapter } from "axios";
/** Spread into PayPal Server SDK `new Client({...})` options. Returns {} unless DUMMYRUN_PAYPAL_API is set. */
export function dummyrun(apiBase?: string): { unstable_httpClientOptions?: { adapter: AxiosAdapter } };
