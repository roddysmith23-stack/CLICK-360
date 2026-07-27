# CLICK 360 P2 Cloud Staging Setup

## Scope

P2 Cloud is emulator-first. It never uses the production project, production
credentials, customer accounts, or production Hosting. The default browser
configuration is disabled. It is only enabled for a loopback URL with the
p2Cloud=emulator query parameter, or an explicit non-production configuration
injected by a staging host.

## Local prerequisites

Run npm ci in the root, then npm ci --prefix functions. Copy .env.example to
.env only for a local emulator session.

Do not place a production project ID, service-account file, OAuth secret, or
customer identifier in .env.

## Emulator run

Run firebase emulators:exec with firebase.p2-emulator.json, project
demo-click360-p2-staging, and npm run qa:p2:cloud.

The staging-only Firestore source is firestore.p2.staging.rules. The existing
firebase.json and firestore.rules remain production-compatible references and
are not deployed by this work.

## Browser smoke

Serve the static app locally, sign in with a synthetic emulator account, and
open a loopback URL with ?p2Cloud=emulator.

The local-only query flag replaces Firebase configuration with
demo-click360-p2-staging. It is rejected on non-loopback hosts and rejects the
production project ID unconditionally.

## Safety controls

- Functions reject the production project and any project that is not explicitly
  non-production.
- All P2 mutations use Functions transactions and idempotency keys.
- The browser repositories have no Admin SDK and only obtain an ID token for
  the authenticated emulator user.
- Firestore Rules allow scoped reads and deny direct critical P2 mutations.
- Invitation documents retain only a SHA-256 token hash. A raw invite token is
  returned once by the endpoint and is not written to Firestore or audit logs.
- Every mutation writes a sanitised P2 audit record and an idempotency marker.

## Rollback

No staging resource is created by this repository. Stop the emulators and
discard the local emulator data directory. A future staging deployment must use
the same immutable commit for Functions, Rules, and Hosting, with a separately
approved release manifest.
