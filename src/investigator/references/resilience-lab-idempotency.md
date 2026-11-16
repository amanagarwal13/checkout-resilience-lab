# Retries and duplicate requests (Resilience Lab notes)

Source: PayPal REST API idempotency reference,
https://developer.paypal.com/api/rest/reference/idempotency/

- PayPal's `POST` calls that move money (create order, capture order, refund
  a capture, capture an authorization) accept a `PayPal-Request-Id` header.
  If PayPal receives the same ID again, it returns the result of the first
  request instead of repeating the action.
- In the PayPal Server SDK the header is the `paypalRequestId` parameter, for
  example `payments.refundCapturedPayment({ captureId, paypalRequestId, body })`.
- The ID must be stable across retries of the same intent. A new random ID per
  attempt gives no protection. Derive it from what the request is for, such as
  `refund-<orderId>-<sku>` or a checkout session ID.
- Timeouts are ambiguous: the money may already have moved. Retry with the
  same `PayPal-Request-Id`, or look the transaction up, before trying again.
- Partial refunds and partial captures can be repeated until the captured
  amount runs out, so a retry without a stable ID can pay out twice.
- Decide in code, not in a prompt, whether an AI agent may move money. Check
  the order, the item, previous refunds and limits on the server before calling
  PayPal.
