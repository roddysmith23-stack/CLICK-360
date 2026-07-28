# CLICK 360 P2 Cloud Security Status

## Scope

This candidate is emulator-only. It does not deploy Functions, Rules, Hosting,
or configuration to `click-360`, and it does not use customer credentials or
customer data.

## Web runtime

The root static PWA contains no Firebase Admin SDK, `google-gax`, or Node
administrative runtime. Its production-surface audit remains independent from
the staging Functions package.

## Administrative Functions package

`functions/` deliberately owns its own `package.json` and lockfile. It uses
the stable compatibility pair `firebase-functions@6.6.0` and
`firebase-admin@13.10.0`; no release candidate, override, downgrade, or
`--force` remediation was used.

At the time this document was written, `npm audit --omit=dev --audit-level=moderate --prefix functions`
reports the known transitive chain through Firebase Admin, Firestore, and
google-gax. The finding is intentionally visible. It is a deployment blocker
for a staging Function until a compatible stable upstream correction exists or
an owner-approved compensating-control decision is recorded.

## Compensating controls for local QA only

- The emulator commands unset explicit credential overrides and use the
  `demo-click360-p2-staging` project.
- The Functions service accepts only the emulator project or an explicit
  `CLICK360_STAGING_PROJECT_ID` allowlist; it rejects `click-360`, an
  unspecified project, and every other project.
- All emulator fixtures use synthetic identities and business IDs.
- Admin SDK stays server-side; browser repositories only call authenticated
  endpoints.
- No emulator command targets production endpoints or data.

## Rollback

The code is isolated to this Draft branch. Stop emulators, remove local
emulator data, and abandon the branch. No cloud resource or production state
requires rollback.
