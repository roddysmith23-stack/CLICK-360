# CLICK 360 r38 — release candidate, not physical certification

Base: modern main `7155238b4e0097c136d9ae9f4be291f25697f012`.
Runtime identifier: `commercial-1-0-5-r38-mvp-candidate`.

## Changes

- Fail-closed full-state replacement guard: resolved identity, actual hydration and non-seed provenance are required. A previously material tenant cannot be replaced by unexpectedly empty commerce, including through force/revision-matching paths. Explicit new-tenant initialization remains separate.
- Critical saves require an authoritative read. Cached, pending or older SDK snapshots cannot lower the applied revision; a read-only transaction retries an older server view. An unverified push is not silently rolled back over committed data.
- Inventory search/actions and cash opening inputs survive same-business access refreshes. Active checkout keeps its cart, tender and button lock; tenant/access/legal/day gates still take precedence.
- Checkout resolves `layawayInitialMethod` lexically. Repeated charge/payment clicks settle once. Cash/card/transfer and layaway transfer accounting remain separate.
- Apartados offers Pendientes, Pagados, Listos, Entregados and Todos without treating ordinary paid retail sales as layaways.
- Label changes are restricted to physical page geometry, row pitch, width sanity and exact quantities. No QR artwork, typography, price or object layout redesign. Legacy nested media values are interpreted through the existing profile precedence, not rewritten by intuition.
- Safe Update deferred reload rechecks active work before navigating. Cold/warm script failures retain a bounded recovery screen.
- SHARY acquisition and offline classification tools are excluded from Hosting. Restoration is identity-pinned, evidence-gated and CAS-protected; rollback refuses intervening writes.

Frozen source regression covers Rules, tenant boundary, domain accounting, Restaurant, Logistics, access/Auth helpers, Safe Update engine, QR artwork and print provider. This is not a claim of a separate formal security audit.

## Not in 1.0

Product exchanges/refunds remain unavailable (OFF). Negative differences/refund policy have not been defined; do not invent accounting rules or mutate original sales. Consider an immutable exchange ledger for 1.1 after policy approval.

## Release gates

1. Local full QA and real browser/emulator regressions, with actual exit codes.
2. PR required checks all green, including Windows recovery tooling.
3. Dedicated staging only: exact candidate artifact, native authenticated synthetic tenant, independent server reads, A/B inventory, offline/online, checkout, cash, layaways, print handoff and boot recovery.
4. Reconcile SHARY PC acquisition against historical C9. C9 is not restore-eligible while newer writes remain unknown. Never use synthetic fixture data for recovery.
5. Exact production preimage/managed backup, entity dry run, live-writer control, CAS restore and two independent server reads. No blind rollback.
6. Merge and revalidate the actual merge SHA; deploy the same static artifact to staging and production with their appropriate Hosting configurations. Hosting-only; authoritative tenant checkpoint before and after must match.
7. Actual SHARY physical acceptance: existing product, four labels/photo, then stock +1/save/reload. Browser/PDF simulation does not satisfy this gate.

Only after all gates: tag `commercial-1-0-5-r38-mvp-certified`, release notes and `CLICK360_COMMERCIAL_MVP_READY`. Until then, preserve the emergency Hosting release and all forensic evidence. Do not publish the certified tag early.

## Recovery operator reference

See `scripts/recovery/README.md` for the one-launch acquisition package and exact guarded backup/restore/rollback commands. The package contains tenant identifiers only, never the recovered commercial payload or credentials. Return only its sanitized ZIP, never private raw browser containers.

Required checks remain `web-runtime-qa`, `web-audit`, `web-rules-qa`, `web-simulators`, `labels-e2e` and `web-release-gate`. Windows `recovery-tooling` and thirty real `inventory-conflict-e2e` races are additional dependencies of the release gate; no existing gate has been relaxed.
