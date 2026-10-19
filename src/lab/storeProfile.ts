import { resolve } from "node:path";

// The demo store DummyRun tests. "original" is the store as its owner wrote
// it; "fixed" is a hand-fixed reference used to check DummyRun's own verdicts.
export const storeBuilds = {
  original: resolve("stores/ember-and-wick/original"),
  fixed: resolve("stores/ember-and-wick/fixed"),
};

// What things should cost, taken from the hand-fixed reference.
export { findProduct, fromCents, toCents } from "../../stores/ember-and-wick/fixed/catalog.js";
export type { StoreOrder } from "../../stores/ember-and-wick/fixed/app.js";
