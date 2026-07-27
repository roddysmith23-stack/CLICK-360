(function (root) {
  'use strict';

  function client() {
    if (!root.CLICK360_P2_CLOUD_CLIENT) throw new Error('p2_cloud_client_missing');
    return root.CLICK360_P2_CLOUD_CLIENT;
  }
  function orders(businessId) { return client().businessRef(businessId).collection('restaurantOrders'); }
  function payments(businessId) { return client().businessRef(businessId).collection('restaurantPayments'); }
  function events(businessId) { return client().businessRef(businessId).collection('restaurantEvents'); }
  function execute(action, input, options) { return client().call(action, input, options); }

  root.CLICK360_P2_RESTAURANT_REPOSITORY = Object.freeze({
    create: (input, options) => execute('createRestaurantOrder', input, options),
    update: (input, options) => execute('appendRestaurantRound', input, options),
    transaction: (action, input, options) => execute(action, input, options),
    retry: (action, input, idempotencyKey) => execute(action, input, { idempotencyKey }),
    read: async (businessId, orderId) => {
      const snapshot = await orders(businessId).doc(client().safeId(orderId, 'order_id')).get();
      return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    },
    subscribe: (businessId, onValue, onError) => client().collectionItems(orders(businessId), onValue, onError),
    subscribePayments: (businessId, onValue, onError) => client().collectionItems(payments(businessId), onValue, onError),
    subscribeEvents: (businessId, onValue, onError) => client().collectionItems(events(businessId), onValue, onError),
    createOrder: (input, options) => execute('createRestaurantOrder', input, options),
    appendRound: (input, options) => execute('appendRestaurantRound', input, options),
    transition: (input, options) => execute('transitionRestaurantOrder', input, options),
    recordPayment: (input, options) => execute('recordRestaurantPayment', input, options),
    cancelOrder: (input, options) => execute('cancelRestaurantOrder', input, options),
    recordPrint: (input, options) => execute('recordRestaurantPrint', input, options),
    offlineState: () => client().offlineState()
  });
})(typeof window !== 'undefined' ? window : globalThis);
