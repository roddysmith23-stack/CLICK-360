'use strict';

const DEFAULT_EMULATOR_PROJECT_ID = 'demo-click360-p2-staging';

function allowedStagingProjects(raw = process.env.CLICK360_STAGING_PROJECT_ID || '') {
  return new Set([
    DEFAULT_EMULATOR_PROJECT_ID,
    ...String(raw).split(',').map((value) => value.trim()).filter(Boolean)
  ]);
}

function stagingProjectAllowed(projectId, raw) {
  const normalized = String(projectId || '').trim();
  return !!normalized && normalized !== 'click-360' && allowedStagingProjects(raw).has(normalized);
}

module.exports = { DEFAULT_EMULATOR_PROJECT_ID, allowedStagingProjects, stagingProjectAllowed };
