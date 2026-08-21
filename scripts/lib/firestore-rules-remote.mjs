/**
 * Reads the currently DEPLOYED Firestore ruleset for a project via the
 * Firebase Rules REST API (firebaserules.googleapis.com), using the same
 * Application Default Credentials already used for firebase-admin/firebase
 * deploy. This is deliberately independent of the local firestore.rules
 * file on disk: the preflight check needs to know what is actually live in
 * the target project, not what this checkout happens to contain.
 */
import { GoogleAuth } from 'google-auth-library';

let cachedClient = null;
async function authClient() {
  if (!cachedClient) {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    cachedClient = await auth.getClient();
  }
  return cachedClient;
}

export async function getDeployedFirestoreRules(projectId) {
  const client = await authClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('RULES_CHECK_NO_TOKEN: could not obtain an access token from Application Default Credentials.');
  const headers = { Authorization: `Bearer ${token}` };
  const releaseRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/releases/cloud.firestore`, { headers });
  if (!releaseRes.ok) throw new Error(`RULES_CHECK_RELEASE_FAILED: ${releaseRes.status} ${await releaseRes.text()}`);
  const release = await releaseRes.json();
  if (!release.rulesetName) throw new Error('RULES_CHECK_NO_RULESET: no active cloud.firestore release found.');
  const rulesetRes = await fetch(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, { headers });
  if (!rulesetRes.ok) throw new Error(`RULES_CHECK_RULESET_FAILED: ${rulesetRes.status} ${await rulesetRes.text()}`);
  const ruleset = await rulesetRes.json();
  const content = ruleset.source?.files?.[0]?.content || '';
  return { content, updateTime:release.updateTime, rulesetName:release.rulesetName };
}

// Markers that must all be present in the deployed ruleset for the Phase
// 3.1-3.3 Workers rollout mechanics (seat cap, per-tenant flag) to be live.
export const REQUIRED_RULES_MARKERS = Object.freeze([
  'workersFeatureFlagEnabled', 'seatConsumedForSelf', 'seatReleased', 'businessUnitReady'
]);

export async function assertWorkersRulesDeployed(projectId) {
  const deployed = await getDeployedFirestoreRules(projectId);
  const missing = REQUIRED_RULES_MARKERS.filter((marker) => !deployed.content.includes(marker));
  return { ok:missing.length === 0, missing, updateTime:deployed.updateTime, rulesetName:deployed.rulesetName };
}
