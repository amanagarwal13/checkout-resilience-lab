# PayPal's advanced-integration example

These files are PayPal's own example checkout, copied from [paypal-examples/docs-examples](https://github.com/paypal-examples/docs-examples) (commit `8095379`), under the Apache License 2.0 (`LICENSE`):

- `server.js` from `advanced-integration/v2/server/node/server.js`
- `client/index.html` and `client/app.js` from `advanced-integration/v2/client/html/src/`

Resilience Lab changed two lines in `server.js`, both marked `// Resilience Lab: added`: an import of `sdk/paypal.js`, and `...resilienceLab()` in the PayPal SDK client options. With `RESILIENCE_LAB_PAYPAL_API` unset they change nothing.

Differences from running it with PayPal's own setup: Resilience Lab serves the page itself, as the example's Vite dev server would (`%PAYPAL_CLIENT_ID%` filled in, `/api` forwarded), and the server runs on this project's `@paypal/paypal-server-sdk` 2.5 rather than the `^1.0.0` in the example's `package.json`.

`../paypal-advanced-example-fixed` is the same code with Resilience Lab's fixes, each marked `// Resilience Lab fix`.
