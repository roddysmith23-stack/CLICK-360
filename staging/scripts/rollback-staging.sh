#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
IMAGE_DIGEST="${IMAGE_DIGEST:-}"
HOSTING_SOURCE="${HOSTING_SOURCE:-click360-staging-7620168025:phase1a-rollback}"

if [[ "$PROJECT_ID" != "click360-staging-7620168025" ]]; then
  echo "STAGING_PROJECT_GUARD_FAILED" >&2
  exit 1
fi

if [[ ! "$IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "VALID_IMAGE_DIGEST_REQUIRED" >&2
  exit 1
fi

gcloud run deploy click360-api-staging \
  --project="$PROJECT_ID" \
  --region=us-central1 \
  --image="us-central1-docker.pkg.dev/$PROJECT_ID/click360-staging/api@$IMAGE_DIGEST" \
  --service-account="click360-api-runtime-stg@$PROJECT_ID.iam.gserviceaccount.com" \
  --quiet

node_modules/.bin/firebase hosting:clone \
  "$HOSTING_SOURCE" \
  "click360-staging-7620168025:live" \
  --project "$PROJECT_ID" \
  --non-interactive

curl --fail --silent --show-error "https://click360-staging-7620168025.web.app/health/ready"
