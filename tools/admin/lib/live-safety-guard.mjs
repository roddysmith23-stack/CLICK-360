export const REQUIRED_LIVE_PROJECT_ID = 'click-360';
export const LIVE_READ_ACK = 'I_UNDERSTAND_THIS_CONNECTS_TO_CLICK_360';
export const LIVE_WRITE_ACK = 'I_AUTHORIZE_A_VERIFIED_CLICK_360_ADMIN_WRITE';

export function resolveAdminExecutionScope({
  explicitProject,
  fixture = false,
  apply = false,
  environment = process.env
} = {}) {
  if (fixture) {
    return { projectId: String(explicitProject || REQUIRED_LIVE_PROJECT_ID), mode: 'FIXTURE' };
  }

  const projectId = String(explicitProject || '');
  if (!projectId) throw new Error('--project click-360 is required for any live administrative connection.');
  if (projectId !== REQUIRED_LIVE_PROJECT_ID) {
    throw new Error(`Refusing project ${projectId}. Only ${REQUIRED_LIVE_PROJECT_ID} is allowed.`);
  }
  if (environment.CLICK360_ADMIN_LIVE_ACK !== LIVE_READ_ACK) {
    throw new Error(`Live access requires CLICK360_ADMIN_LIVE_ACK=${LIVE_READ_ACK}.`);
  }
  if (apply && environment.CLICK360_ADMIN_WRITE_ACK !== LIVE_WRITE_ACK) {
    throw new Error(`Live writes require CLICK360_ADMIN_WRITE_ACK=${LIVE_WRITE_ACK}.`);
  }
  return { projectId, mode: apply ? 'LIVE_WRITE' : 'LIVE_READ_ONLY' };
}
