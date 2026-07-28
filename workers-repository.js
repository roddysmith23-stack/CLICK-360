(function (root) {
  'use strict';

  function client() {
    if (!root.CLICK360_P2_CLOUD_CLIENT) throw new Error('p2_cloud_client_missing');
    return root.CLICK360_P2_CLOUD_CLIENT;
  }
  function memberCollection(businessId) { return client().businessRef(businessId).collection('members'); }
  function invitationCollection(businessId) { return client().businessRef(businessId).collection('invitations'); }
  function operation(action, payload, options) { return client().call(action, payload, options); }
  function create(input, options) { return operation('inviteWorker', input, options); }
  function update(input, options) { return operation('activateUser', input, options); }
  function transaction(action, input, options) { return operation(action, input, options); }
  function retry(action, input, idempotencyKey) { return operation(action, input, { idempotencyKey }); }

  root.CLICK360_P2_WORKERS_REPOSITORY = Object.freeze({
    create,
    update,
    transaction,
    retry,
    read: async (businessId, uid) => {
      const snapshot = await memberCollection(businessId).doc(client().safeId(uid, 'member_uid')).get();
      return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    },
    subscribe: (businessId, onValue, onError) => client().collectionItems(memberCollection(businessId), onValue, onError),
    subscribeInvitations: (businessId, onValue, onError) => client().collectionItems(invitationCollection(businessId), onValue, onError),
    inviteWorker: (input, options) => operation('inviteWorker', input, options),
    revokeWorker: (input, options) => operation('revokeWorker', input, options),
    acceptInvitation: (input, options) => operation('acceptInvitation', input, options),
    regenerateInvitation: (input, options) => operation('regenerateInvitation', input, options),
    expireInvitation: (input, options) => operation('expireInvitation', input, options),
    suspendUser: (input, options) => operation('suspendUser', input, options),
    reactivateUser: (input, options) => operation('reactivateUser', input, options),
    offlineState: () => client().offlineState()
  });
})(typeof window !== 'undefined' ? window : globalThis);
