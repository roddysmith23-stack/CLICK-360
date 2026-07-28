# CLICK 360 P2 Functions Security Remediation

Status: `NO_GO_P2_FUNCTIONS_SECURITY`

Scope: official stable dependency remediation for the isolated `functions` package only. This branch is stacked on `qa/p2-cloud-multiuser-integration` at `5906a79247ed8cc1870c850a19e54f3b5cb030ef`. No Firebase project, production data, Rules, Authentication provider, Hosting, or deployment is changed.

## Baseline

| Item | Value |
| --- | --- |
| Local Node | `v24.11.1` |
| Local npm | `11.6.2` |
| Node 22 validation runtime | `v22.23.1` |
| Functions engine | `20` |
| `firebase-admin` | `13.10.0` |
| `firebase-functions` | `6.6.0` |
| Local production audit | 8 moderate findings, exit 1 |
| PR #36 remote production audit | 9 moderate findings, exit 1 |

The remote and local audit tools report a different count for the same lockfile. Both identify the same vulnerable family and remain blocking. The discrepancy is retained as evidence and is not suppressed.

### Baseline Tree

```text
firebase-admin@13.10.0
├─ @google-cloud/firestore@7.11.6
│  └─ google-gax@4.6.1
│     ├─ gaxios@6.7.1
│     ├─ retry-request@7.0.2
│     └─ uuid@9.0.1
└─ @google-cloud/storage@7.21.0
   ├─ gaxios@6.7.1 -> uuid@9.0.1
   └─ retry-request@7.0.2 -> teeny-request@9.0.0 -> uuid@9.0.1
```

The affected advisory is `GHSA-w5hq-g745-h8pq`: `uuid <11.1.1` lacks a buffer bounds check for selected APIs. The audit also reports the affected Firestore, Storage, `google-gax`, `gaxios`, `retry-request`, and `teeny-request` paths.

## Compatibility Review

All Functions and emulator fixture imports are modular CommonJS imports:

- `firebase-admin/app`: `initializeApp`, `getApps`
- `firebase-admin/auth`: `getAuth`
- `firebase-admin/firestore`: `getFirestore`, `FieldValue`, `Timestamp`

No `require('firebase-admin')` namespace import, Instance ID API, Storage Admin API, or ESM migration was found. The code therefore needs no API refactor for the planned Admin SDK update unless the official package proves otherwise during validation.

## Approved Experiment

1. Change the Functions engine from Node 20 to Node 22.
2. Install exactly `firebase-admin@14.2.0` using standard npm installation.
3. Keep `firebase-functions@6.6.0` unless a demonstrated compatibility error requires a separate decision.
4. Run the production audit first. The emulator, browser protocol, and remote CI
   suites are gated on an audit exit code of zero.

No `--force`, override, resolution, RC, experimental package, direct transitive dependency injection, or production operation is permitted.

## Results

### Official Stable Candidate

The first installation used only normal npm commands under Node `v22.23.1`:

```text
npm install firebase-admin@14.2.0 --save-exact
```

`firebase-functions@6.6.0` emitted a real peer dependency warning because it
permits Firebase Admin through major 13 only. No source code was changed. The
only stable Firebase Functions release found in the official npm registry with
an Admin 14 peer range was `firebase-functions@7.3.0`; current `latest` and
`next` tags are release candidates and were not installed. The compatible
stable retry used:

```text
npm install firebase-functions@7.3.0 --save-exact
```

The resulting candidate was:

| Item | Baseline | Candidate |
| --- | --- | --- |
| Functions engine | `20` | `22` |
| `firebase-admin` | `13.10.0` | `14.2.0` |
| `firebase-functions` | `6.6.0` | `7.3.0` |
| Node validation runtime | n/a | `v22.23.1` |
| `npm run check` | n/a | PASS |
| `npm run qa:unit` | n/a | PASS |
| Production audit | 8 moderate, exit 1 | 7 moderate and 5 high, exit 1 |

No legacy namespace API is used, and the candidate passed the Functions static
check plus unit tests under Node 22:

```text
P2 staging project boundary unit: PASS
P2 admin service unit: PASS
```

### Candidate Tree And Findings

```text
firebase-admin@14.2.0
├─ @google-cloud/firestore@8.7.0
│  └─ google-gax@5.0.8
│     └─ rimraf@5.x -> glob@10.x -> minimatch -> brace-expansion@2.1.2
│        GHSA-mh99-v99m-4gvg (high)
└─ @google-cloud/storage@7.21.0
   ├─ gaxios@6.7.1 -> uuid@9.0.1
   └─ retry-request@7.0.2 -> teeny-request@9.0.0 -> uuid@9.0.1
      GHSA-w5hq-g745-h8pq (moderate)
```

The registry confirms these are the current stable official versions used by
the candidate:

- `firebase-admin@14.2.0` is `latest` and declares optional
  `@google-cloud/firestore@^8.6.0` and `@google-cloud/storage@^7.19.0`.
- `@google-cloud/firestore@8.7.0` is `latest` and declares
  `google-gax@^5.0.1`.
- `google-gax@5.0.8` is `latest`; its `rimraf@^5.0.1` resolution remains in
  the high-severity advisory range.
- `@google-cloud/storage@7.21.0` is `latest`; its declared `gaxios@^6.0.2`,
  `retry-request@^7.0.0`, and `teeny-request@^9.0.0` resolutions retain the
  `uuid@9.0.1` advisory path.

`npm update` was executed after the candidate installation with no force,
override, or direct transitive dependency. It produced no lockfile change and
the same `12` findings. `npm audit` proposes a breaking downgrade to
`firebase-admin@10.3.0` for the remaining UUID advisory; that proposal was not
used because it violates this remediation's compatibility constraints.

### Gated Tests Not Run

The audit exit code remained `1`, so the required full root and Functions
emulator suites, Chromium repetition, three clean WebKit runs, and remote CI
were intentionally not run. Running them would not make a failing production
dependency audit acceptable. The documented PASS checks above establish only
source compatibility of the rejected candidate, not release readiness.

### Upstream Evidence

The upstream evidence is [firebase/firebase-admin-node#3221](https://github.com/firebase/firebase-admin-node/issues/3221).
It contains only package versions and advisories, with no Firebase project,
credentials, tenant, or production data.

### Final Change Set

The candidate dependency and Node engine edits are intentionally not retained
in this Draft remediation branch. They are restored to the PR #36 base after
recording this evidence, so the branch does not propose an audit-worsening
runtime change. This document is the reviewable outcome.

## CI And Production Boundary

The existing Functions CI jobs already use Node 22 and retain a blocking
`functions-security-audit` job without `continue-on-error`. No CI file is
changed because changing its status cannot resolve the dependency finding.
The separate web runtime audit remains clean. No Firebase service, Rules,
Authentication setting, project, customer data, or deployment was accessed or
changed during this investigation.

## Risk And Verdict

`NO_GO_P2_FUNCTIONS_SECURITY`: the official Admin 14 and Functions 7.3.0
candidate does not meet the mandatory audit-zero gate and introduces five
high-severity findings. Keep PR #36 Draft and leave its stable P2 Cloud branch
unchanged. Revisit only when official stable upstream releases resolve both
the Firestore/gax and Storage/uuid chains.

## Rollback

The rejected candidate is restored to the base `functions/package.json` and
`functions/package-lock.json` state, including the Node 20 engine declaration.
No data rollback is required because this branch performs no deployment or
cloud write.
