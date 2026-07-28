(function (root) {
  'use strict';

  const PRODUCTION_PROJECT_ID = 'click-360';
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(String(root.location?.hostname || ''));
  const query = new URLSearchParams(String(root.location?.search || ''));
  const requestedEmulator = loopback && query.get('p2Cloud') === 'emulator';
  const requested = root.CLICK360_P2_CLOUD_CONFIG || (requestedEmulator ? {
    enabled: true,
    environment: 'emulator',
    projectId: 'demo-click360-p2-staging',
    useEmulators: true,
    authEmulatorUrl: 'http://127.0.0.1:9099',
    firestoreEmulatorHost: '127.0.0.1',
    firestoreEmulatorPort: 8080,
    functionsOrigin: 'http://127.0.0.1:5001/demo-click360-p2-staging/us-central1'
  } : {});
  const environment = String(requested.environment || 'disabled').toLowerCase();
  const projectId = String(requested.projectId || '');
  const explicitNonProduction = environment === 'emulator' || environment === 'staging';
  const safeProject = !!projectId && projectId !== PRODUCTION_PROJECT_ID;
  const enabled = requested.enabled === true && explicitNonProduction && safeProject;
  const config = Object.freeze({
    enabled,
    environment: enabled ? environment : 'disabled',
    projectId: enabled ? projectId : '',
    useEmulators: enabled && requested.useEmulators === true,
    authEmulatorUrl: enabled ? String(requested.authEmulatorUrl || '') : '',
    firestoreEmulatorHost: enabled ? String(requested.firestoreEmulatorHost || '') : '',
    firestoreEmulatorPort: enabled ? Number(requested.firestoreEmulatorPort || 0) : 0,
    functionsOrigin: enabled ? String(requested.functionsOrigin || '') : '',
    reason: enabled ? '' : 'p2_cloud_requires_explicit_non_production_configuration'
  });

  if (enabled) {
    root.CLICK360_FIREBASE_CONFIG = {
      apiKey: 'demo-click360-p2-staging',
      authDomain: projectId + '.firebaseapp.com',
      projectId,
      appId: '1:000000000000:web:' + projectId
    };
  }

  root.CLICK360_P2_CLOUD = Object.freeze({
    config,
    isEnabled: () => config.enabled,
    isEmulator: () => config.enabled && config.useEmulators,
    assertNonProduction: () => {
      if (!config.enabled || config.projectId === PRODUCTION_PROJECT_ID) {
        throw new Error('p2_cloud_non_production_required');
      }
      return config;
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
