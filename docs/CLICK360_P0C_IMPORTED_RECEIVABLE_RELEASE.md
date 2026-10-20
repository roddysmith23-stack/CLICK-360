# P0C — imported retail receivables

Base: production `32ed65c78032b37acae3bb81ce4becbdddbb2e88`.

## Confirmed compatibility defect

Published legacy Apartado records can contain `layaway.saleId` without
`sale.layawayId`. The original modular payment/status boundary requires both,
so an otherwise valid imported receivable cannot receive a later payment.
This is not a stock, quota or authentication failure.

## Bounded correction

- Keep every original sale/reservation ID, amount, payment and absent forward
  field. Do not normalize or repair the source snapshot.
- The codec exposes read-only import provenance from immutable wrapper fields,
  never from a client-supplied material data property; packing excludes it.
- UI/kernel accept an absent forward link only with matching import hashes
  and the exact same-business reverse sale relation. Explicit conflicting
  forward links remain failures.
- Client Rules independently require owner/business/record identity and
  matching immutable sales/layaways source provenance. Financial writes remain
  one transaction: receipt, sale, reservation, exact cash session and ledger.
- Source handoff rejects duplicate, missing, cross-business or inconsistent
  active relationships and inconsistent balances/payment histories.
- No cutover or tenant policy is activated by this patch. Legacy and P0A
  paths, Founder entitlements and storage limits remain unchanged.

## Regression evidence required before promotion

The served report journey also reproduced a background access refresh
detaching its query button before click. Same-business modular reports now
retain that control on background refresh only; explicit filter/navigation
and result renders, business switches and authorization gates remain active.
The shared PWA report test forces this refresh and requires node/handler
preservation before its real authoritative query, without sleeps or retries.

Real staging WebKit then exposed `SPARK_REPORT_RANGE_INVALID`: an asynchronous
durable projection could finish after editing the date inputs, replacing the
controller's UI filters with the older candidate's absent filters while the
preserved DOM still showed valid dates. A same-business report projection now
retains the latest UI-only filters at completion. The shared served-PWA test
finishes a filterless durable projection after editing the dates and requires
both dates and the full authoritative report to survive. No financial fields,
Rules, date-range checks, server confirmation, or timeouts are relaxed.

- `qa-spark-imported-receivable-links.mjs` (included by command adapter CI):
  codec provenance, missing-forward compatibility, adversarial links, no
  source rewrite, payment and pickup boundaries.
- `qa-spark-operational-client-rules.mjs`: real Web SDK imported receipt,
  idempotent retry/conflicting payload, wrong reverse link denied, no extra
  sale or stock decrement, imported pickup.
- `qa/spark-real-staging-shadow-e2e.mjs`: synthetic historical active Apartado
  without forward link, automatic import/readback/cutover, later receipt via
  the actual PWA, original fields and stock preserved, exact receipt ledger.
- All existing Rules parity, legacy/P0A permissions, budget/headroom,
  operational browser and release gates must pass for the final source SHA.

Real customer snapshots, identities, private approval drafts and credentials
remain outside Git. Real activation still requires separate owner authority,
current original-device source stability and authoritative shadow equality.
