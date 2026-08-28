/**
 * Synthetic canonical staging QA tenant credentials, sourced from the
 * environment only -- never hardcoded, never logged, never written to any
 * artifact/screenshot. This account is a synthetic founder_legacy test
 * tenant on click360-staging-7620168025; it is not a real customer.
 *
 * Required environment variables (documented here by NAME only -- this
 * file, and every caller, must never contain a real value):
 *
 *   CLICK360_QA_STAGING_EMAIL
 *   CLICK360_QA_STAGING_PASSWORD
 *
 * Local runs: export both in your own shell/.env (untracked). CI: configure
 * both as GitHub Actions repository or environment secrets -- never place
 * real values in workflow YAML, package.json, or README.
 */
export function requireStagingQaCredentials() {
  const email = process.env.CLICK360_QA_STAGING_EMAIL;
  const password = process.env.CLICK360_QA_STAGING_PASSWORD;
  if (!email || !password) {
    console.error(
      'Missing staging QA credentials: set CLICK360_QA_STAGING_EMAIL and ' +
      'CLICK360_QA_STAGING_PASSWORD in the environment before running this ' +
      'test (synthetic canonical staging tenant only, never a real customer).'
    );
    process.exit(1);
  }
  return { email, password };
}
