import type { AxiosAdapter } from "axios";
/** Spread into PayPal Server SDK `new Client({...})` options. Returns {} unless RESILIENCE_LAB_PAYPAL_API is set. */
export function resilienceLab(apiBase?: string): { unstable_httpClientOptions?: { adapter: AxiosAdapter } };
