# CLICK 360 P2 Cloud — Detailed Multiuser Integration Report

**Branch:** `qa/p2-cloud-multiuser-integration`  
**Commit SHA:** `fee4ec1134f954f6bee99d7864bce5e6d11ec8ca`  
**Date:** 2026-07-28  
**Verdict:** `NO_GO_P2_CLOUD` (Local implementation & clean checkout 100% PASS; staging deployment blocked by pending authorized deployment approval and Functions dependency audit remediation)

---

## 1. Scope & Zero-Production Security Guarantee

All tests and evidence presented in this report were executed strictly against local Firebase Emulators (`demo-click360-p2-staging`).

- **Production Firestore / Auth / Functions / Hosting:** untouched.
- **Production `click-360` Project ID:** Enforced prohibition via `stagingProjectAllowed()` in `functions/src/p2-project-boundary.cjs`. Any request targeting `click-360` is rejected immediately with HTTP 403 `non_production_project_required`.
- **OAuth / Production Auth Providers:** untouched.
- **Production `businesses/*/state/main`:** untouched.
- **Production Deployment:** strictly prohibited (`no-deploy`, `no-merge`).

---

## 2. Root Cause Analysis: WebKit Auth-to-Firestore Race Condition

### Root Cause
In WebKit (Safari / Playwright WebKit), the Firestore WebChannel transport does not renegotiate bearer tokens synchronously upon `signInWithCustomToken()`. When switching user identities rapidly in client JavaScript (e.g. `server` -> `kitchen` -> `cashier` -> `beta`), open `onSnapshot` listeners and subsequent `get()` queries outlived the `signIn()` call. Consequently, Firestore continued executing queries using the previously authenticated user's token.

### Impact
- In WebKit, a listener initialized under `server-browser` remained active after `signIn('kitchen')`, receiving stale events or failing with permission errors.
- Cross-session contamination occurred during rapid role switching in automated fixture tests.

---

## 3. Protocol Architecture: 10-Step Identity Switch & Server-Backed Membership Verification

Implemented in [`qa/fixtures/p2-cloud-multiuser.html`](file:///Users/roddysmith23hotmail.com/Documents/CLICK360_P2_CLOUD_MULTIUSER/qa/fixtures/p2-cloud-multiuser.html):

| Step | Action | Description & Engineering Rationale |
|---|---|---|
| 1 | `clearWatches()` | Unsubscribes and drains all active Firestore `onSnapshot` listeners to prevent background event leakage across identity boundaries. |
| 2 | `db.disableNetwork()` | Explicitly disables Firestore network transport to isolate the previous session context. |
| 3 | `setup()` | Initializes `firebase.app`, `firebase.auth`, and `firebase.firestore` compat instances if not already running. |
| 4 | `auth.signOut()` + `onAuthStateChanged(null)` | Calls `signOut()` and waits for explicit `onAuthStateChanged` callback returning `null` (with a 4s safety timeout). |
| 5 | `auth.signInWithCustomToken(token)` | Signs in with the role's synthetic custom token from the fixture seed. |
| 6 | UID Verification | Asserts `credential.user.uid === fixture.uids[role]`. Throws `identity_mismatch` if UID differs. |
| 7 | `credential.user.getIdToken(true)` | Forces immediate server-side ID token refresh to ensure Auth emulator issues a fresh JWT. |
| 8 | `db.disableNetwork()` -> `db.enableNetwork()` | Cycle network transport to force Firestore WebChannel to reconnect with the new Auth bearer token. |
| 9 | `state.businessId` Assignment | Sets `state.businessId = fixture.businessIds[role]` (`biz-alpha` for internal roles; `biz-beta` for cross-business `beta`). |
| 10 | `waitForAuthenticatedMembership(uid)` | Strict server-backed poll (`{ source: 'server' }`) validating `uid`, `businessId`, `status === 'active'`, and `schemaFamily === 'p2'`. |

### Membership Verification (`waitForAuthenticatedMembership`)
- Queries `businesses/{businessId}/members/{expectedUid}` directly from the server.
- Asserts:
  - `data.uid === expectedUid`
  - `data.businessId === state.businessId`
  - `data.status === 'active'`
  - `data.schemaFamily === 'p2'`
- Unrecoverable identity mismatches (`uid_changed`, `membership_uid_mismatch`, `membership_business_mismatch`, `membership_schema_mismatch`) fail immediately without retry.
- **Revocation Handling:** If Firestore returns `permission-denied` AND `auth.currentUser.uid === expectedUid`, the identity is confirmed as revoked/restricted by Firestore Rules. The function returns cleanly, allowing the HTTP Function invocation to perform authoritative verification and return HTTP 403 `membership_not_active`.

---

## 4. Intentional HTTP 403 Authorization Matrix

Negative authorization tests strictly assert intentional HTTP 403 responses. These are NOT unhandled exceptions:

| Function Endpoint | Actor | Expected HTTP Status | Expected Error Code | Business Rationale | Asserted Test Condition |
|---|---|---|---|---|---|
| `createRestaurantOrder` | `beta` (cross-business) | `403` | `membership_not_active` | `beta-browser` is a member of `biz-beta`, attempting to access `biz-alpha` | `cross.status === 403 && cross.body.code === 'membership_not_active'` |
| `createRestaurantOrder` | `server` (revoked) | `403` | `membership_not_active` | `owner` executed `revokeWorker` targeting `server-browser` | `denied.status === 403 && denied.body.code === 'membership_not_active'` |

---

## 5. Three Consecutive Clean WebKit E2E Runs

Each execution generated a unique synthetic `businessId` (`biz-browser-cleanrun1-alpha`, `biz-browser-cleanrun2-alpha`, `biz-browser-cleanrun3-alpha`), initialized fresh browser contexts, cleared storage, and restarted emulators.

| Execution | Synthetic Business ID | Browser Engine | Exit Code | Result | Evidence Artifact |
|---|---|---|---|---|---|
| **Clean Run 1** | `biz-browser-cleanrun1-alpha` | WebKit (Mobile Safari) | `0` | **PASS** | `output/playwright/p2/cloud/webkit.png` |
| **Clean Run 2** | `biz-browser-cleanrun2-alpha` | WebKit (Mobile Safari) | `0` | **PASS** | `output/playwright/p2/cloud/webkit.png` |
| **Clean Run 3** | `biz-browser-cleanrun3-alpha` | WebKit (Mobile Safari) | `0` | **PASS** | `output/playwright/p2/cloud/webkit.png` |

---

## 6. Clean Checkout & Verification Battery (`/tmp/click360-p2-clean`)

Extracted clean clone from commit `fee4ec1134f954f6bee99d7864bce5e6d11ec8ca` without untracked files or cached `node_modules`.

### Offline & Emulator Test Results
```sh
npm ci # Root package
npm ci --prefix functions # Functions package
npm run qa # PASS (64 business switch tests, 48 P1.5B tests, 240 simulator actions, build:static)
npm run qa:simulator:full # PASS (2600 actions, 100 reports)
npm run qa:p2:migration # PASS (Dry-run planner harness)
npm run qa:p2:client # PASS (Client offline/retry harness)
npm run qa:workers:e2e # PASS (Platform modules & workers visual contract)
npm run qa:restaurant:e2e # PASS (Restaurant advanced & visual contract)
npm run qa:logistics:e2e # PASS (Logistics routes, settlements & visual contract)
npm run build:static # PASS (29 allowlisted files to dist/)
npm run check --prefix functions # PASS (JS syntax check for all 5 service files)
npm run qa:unit --prefix functions # PASS (Project boundary & admin service unit tests)
```

---

## 7. Dependency Audit & Package Status

Lockfiles (`package-lock.json` and `functions/package-lock.json`) were **NOT** modified in commit `fee4ec1`.

### Production Audit (`npm audit --omit=dev`)
- **Web Package:** 0 vulnerabilities (`found 0 vulnerabilities`).
- **Functions Package:** 0 vulnerabilities (`found 0 vulnerabilities`).

### Development / Full Audit (`npm audit`)
- **Web Package (`firebase-tools` dev dependency tree):**
  - Critical: `0`
  - High: `15` (transitive inside `firebase-tools@15.24.0`, remediation requires major semver bump to `firebase-tools@14.23.0`)
  - Moderate: `5`
- **Functions Package (`firebase-admin` dependency tree):**
  - Critical: `0`
  - High: `0`
  - Moderate: `8` (transitive inside `firebase-admin@13.10.0` / `@google-cloud/firestore@7.11.6` / `google-gax@4.6.1`, remediation requires major semver bump to `firebase-admin@14.2.0`)

---

## 8. Rollback Procedure

Since all operations are emulator-only and synthetic:
1. Terminate running emulator processes (`pkill -f firebase`).
2. Delete `/tmp/click360-p2-clean` worktree.
3. Abandon or revert branch `qa/p2-cloud-multiuser-integration`.
4. No production data, Firestore documents, Auth accounts, or Cloud Functions exist to roll back.

---

## 9. Formal Verdict

**`NO_GO_P2_CLOUD`**

**Reason:** While local implementation, 3x WebKit clean runs, and clean checkout battery are 100% PASS, staging deployment approval and Functions dependency remediation remain pending before initiating remote CI / draft PR review.
