(function (root) {
  'use strict';

  function client() {
    if (!root.CLICK360_P2_CLOUD_CLIENT) throw new Error('p2_cloud_client_missing');
    return root.CLICK360_P2_CLOUD_CLIENT;
  }
  function collection(businessId, name) { return client().businessRef(businessId).collection(name); }
  function execute(action, input, options) { return client().call(action, input, options); }

  root.CLICK360_P2_LOGISTICS_REPOSITORY = Object.freeze({
    create: (input, options) => execute('createRoute', input, options),
    update: (input, options) => execute('assignRoute', input, options),
    transaction: (action, input, options) => execute(action, input, options),
    retry: (action, input, idempotencyKey) => execute(action, input, { idempotencyKey }),
    read: async (businessId, routeId) => {
      const snapshot = await collection(businessId, 'routes').doc(client().safeId(routeId, 'route_id')).get();
      return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    },
    subscribe: (businessId, onValue, onError) => client().collectionItems(collection(businessId, 'routes'), onValue, onError),
    subscribeLoadSheets: (businessId, onValue, onError) => client().collectionItems(collection(businessId, 'loadSheets'), onValue, onError),
    subscribeSales: (businessId, onValue, onError) => client().collectionItems(collection(businessId, 'routeSales'), onValue, onError),
    subscribeCollections: (businessId, onValue, onError) => client().collectionItems(collection(businessId, 'collections'), onValue, onError),
    createVehicle: (input, options) => execute('createVehicle', input, options),
    createRoute: (input, options) => execute('createRoute', input, options),
    assignRoute: (input, options) => execute('assignRoute', input, options),
    createLoadSheet: (input, options) => execute('createLoadSheet', input, options),
    confirmLoadSheet: (input, options) => execute('confirmLoadSheet', input, options),
    dispatchLoadSheet: (input, options) => execute('dispatchLoadSheet', input, options),
    createRouteSale: (input, options) => execute('createRouteSale', input, options),
    recordCollection: (input, options) => execute('recordCollection', input, options),
    recordReturn: (input, options) => execute('recordReturn', input, options),
    recordRouteExpense: (input, options) => execute('recordRouteExpense', input, options),
    createSettlement: (input, options) => execute('createRouteSettlement', input, options),
    approveSettlement: (input, options) => execute('approveRouteSettlement', input, options),
    closeSettlement: (input, options) => execute('closeRouteSettlement', input, options),
    reopenSettlement: (input, options) => execute('reopenRouteSettlement', input, options),
    offlineState: () => client().offlineState()
  });
})(typeof window !== 'undefined' ? window : globalThis);
