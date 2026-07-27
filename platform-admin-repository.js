(function (root) {
  'use strict';

  function client() {
    if (!root.CLICK360_P2_CLOUD_CLIENT) throw new Error('p2_cloud_client_missing');
    return root.CLICK360_P2_CLOUD_CLIENT;
  }
  function operation(action, payload, options) { return client().call(action, payload, options); }
  function featureRef(businessId) { return client().businessRef(businessId).collection('featureConfig').doc('main'); }

  root.CLICK360_P2_PLATFORM_ADMIN_REPOSITORY = Object.freeze({
    create: (input, options) => operation('activateUser', input, options),
    update: (input, options) => operation('updateBusinessModules', input, options),
    read: async (businessId) => {
      const snapshot = await featureRef(businessId).get();
      return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    },
    subscribe: (businessId, onValue, onError) => client().subscribe(featureRef(businessId), onValue, onError),
    transaction: (action, input, options) => operation(action, input, options),
    retry: (action, input, idempotencyKey) => operation(action, input, { idempotencyKey }),
    inspectUserAccess: (input, options) => operation('inspectUserAccess', input, options),
    activateUser: (input, options) => operation('activateUser', input, options),
    suspendUser: (input, options) => operation('suspendUser', input, options),
    reactivateUser: (input, options) => operation('reactivateUser', input, options),
    updatePlan: (input, options) => operation('updatePlan', input, options),
    updateBusinessModules: (input, options) => operation('updateBusinessModules', input, options),
    offlineState: () => client().offlineState()
  });
})(typeof window !== 'undefined' ? window : globalThis);
