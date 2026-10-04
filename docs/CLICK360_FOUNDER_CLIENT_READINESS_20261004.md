# Founder floor and client readiness — isolated P0 release

Base: `6f83372c89fc44a000a1f30876998d3522dbd6d2` (#90). No modular code is ported from #92.

## Confirmed causes and correction

The earlier online device guard was coupled to the 850000-byte legacy cloud guard; #90 already separates the durable 8 MiB device budget. This release preserves it unchanged. A historical manual override could still reduce acquired Founder rights: the effective wrapper now applies a floor of 2 businesses / 2 workers / 2000 active products. Larger overrides remain additive; other plans and the frozen domain are unchanged. No account document is edited.

The prior worker reused the same cache across releases. Static builds now stamp a cache per SHA, verify every precached asset against the served manifest, and activate only a complete matching release. Existing cached releases and all IndexedDB/localStorage data are retained. Mixed core assets are detected by a build identity check before mutations. Automatic reload also waits for an in-flight durable device commit. Startup readiness is non-destructive and sanitized; legacy snapshot journals do not falsely claim independently reconciled unknown remote outcomes.

## Permanent regression coverage

`qa/founder-opening-readiness-e2e.mjs` executes the served built application: historical 600 override, actual cash opening $0, 860 KB / 900 KB / 1.2 MiB / 3 MiB / 7 MiB; durable IDB; no legacy push; truthful pending UI; retained products/sales/reports; full browser-process restart; safe >8 MiB rejection. WebKit iPhone-shaped, Chromium mobile and desktop are automated profiles, not physical acceptance.

`qa/founder-pwa-upgrade-e2e.mjs` upgrades an actual preserved previous build in Chromium/WebKit, rejects a mixed install, retains IDB stock and pending journal plus valid localStorage. Both tests are mandatory in `device-capacity-required`; no check is disabled. `qa/built-artifact-smoke.mjs` verifies the exact per-SHA cache.

All principal mutation routes use shared `save()` / critical commit plumbing; the only 850000-byte comparisons in app persistence remain cloud-capacity classification, never the device rejection guard. Bootstrap uses 8 MiB and cannot replace a large existing tenant with an empty seed. Cloud/IDB CAS and remote-hydration fences from #90 remain intact.

## Release and rollback gates

Require complete PR CI, served staging synthetic commerce, exact build identity, fresh native read-only commercial backup/reconciliation and verified recoverable current Hosting version. Merge only this small PR; require merge-commit CI again; build that exact SHA; deploy Hosting only. Never deploy Rules/Functions/indexes or execute migration/data repair.

Preserve the current immutable Hosting version on a rollback channel, verify its files and rehearse restoration on a non-live channel. Roll back Hosting to that #90 version if necessary, without touching data stores; pending local commercial records must remain protected. Forward fix is preferable if a later incompatible local schema is introduced (none is introduced here).

Before/after Hosting: native backup SHA256, revision/material comparison, one historical $30 sale/movement/closed-session report, stock/qty consistency, no duplicate IDs. No customer identifiers or backup contents in public reports. Physical acceptance remains pending until ONE opening $0 followed by closing/reopening the app visibly retains the journey. No repeated historical sale or closure.

## Residual capacity risk

The local capacity bridge is temporary, not modular cloud backup. Above 850000 bytes the full snapshot remains durable on this device and explicitly cloud-pending. Device loss remains a risk until separately authorized modular reconciliation/cutover. #92 stays DEV/draft. No 100 MiB legacy document, pricing change, or global cutover is included.
