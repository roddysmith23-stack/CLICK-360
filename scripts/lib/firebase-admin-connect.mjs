/** Shared Firebase Admin SDK connection helpers for the worker-boundary scripts. */

export async function connectAdmin(projectId, appLabel = 'worker-boundary') {
  const [{ applicationDefault, getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/firestore')
  ]);
  const app = getApps().find((candidate) => candidate.options.projectId === projectId)
    || initializeApp({ credential:applicationDefault(), projectId }, `${appLabel}-${projectId}`);
  return getFirestore(app);
}

export async function connectAuth(projectId) {
  const [{ getApps }, { getAuth }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth')]);
  const app = getApps().find((candidate) => candidate.options.projectId === projectId);
  return getAuth(app);
}
