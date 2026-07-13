import { validV10StateShape } from './click360-data-core.mjs';

export function normalizeOwnerAccessAssessment({ uid, approvedUser, authUser, stateDocument }) {
  const reasons = [];
  const data = approvedUser || {};
  const emailMatches = !data.email || !authUser?.email
    || String(data.email).toLowerCase() === String(authUser.email).toLowerCase();
  const stateIdentityMatches = stateDocument?.schemaVersion === 10
    && stateDocument.ownerUid === uid
    && stateDocument.ownerId === uid
    && stateDocument.businessId === uid
    && stateDocument.tenantKey === `owner:${uid}:business:${uid}`
    && stateDocument.payload?.schemaVersion === 10
    && stateDocument.payload?.identity?.ownerUid === uid
    && stateDocument.payload?.identity?.ownerId === uid
    && stateDocument.payload?.identity?.businessId === uid
    && stateDocument.payload?.identity?.tenantKey === `owner:${uid}:business:${uid}`
    && validV10StateShape(stateDocument.payload?.data);

  if (!uid) reasons.push('uid_missing');
  if (!approvedUser) reasons.push('approved_user_missing');
  if (!authUser) reasons.push('auth_user_missing');
  if (authUser?.disabled) reasons.push('auth_user_disabled');
  if (data.status && data.status !== 'active') reasons.push('approved_user_not_active');
  if (data.role !== 'owner' && data.isOwner !== true) reasons.push('approved_user_not_owner');
  if (data.ownerId && data.ownerId !== uid) reasons.push('approved_owner_mismatch');
  if (!emailMatches) reasons.push('approved_email_mismatch');
  if (!stateIdentityMatches) reasons.push('tenant_v10_identity_invalid');

  const patch = {};
  if (data.approved !== true) patch.approved = true;
  if (data.ownerId !== uid) patch.ownerId = uid;
  if (!data.status) patch.status = 'active';
  return {
    allowed: reasons.length === 0,
    action: reasons.length ? 'BLOCKED' : (Object.keys(patch).length ? 'NORMALIZATION_REQUIRED' : 'ALREADY_NORMALIZED'),
    reasons,
    patch,
    stateIdentityMatches
  };
}
