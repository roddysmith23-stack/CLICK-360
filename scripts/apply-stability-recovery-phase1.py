from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match in {path}, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'patched {label}: {path}')


# 1) One coherent asset/cache version for the whole runtime.
replace_once(
    'app.js',
    "const APP_ASSET_VERSION = 'commercial-1-0-5-r20';",
    "const APP_ASSET_VERSION = 'commercial-1-0-5-r29';",
    'runtime asset version r29',
)
replace_once(
    'service-worker.js',
    "const CACHE = 'click360-commercial-1-0-5-r28';",
    "const CACHE = 'click360-commercial-1-0-5-r29';",
    'service worker cache r29',
)

# 2) Expose trustworthy local business counts and auto-recover EMPTY LOCAL from cloud.
old_sync_block = """\t\t  function showSyncConflictRecovery(gate = {}) {\n\t\t    const syncState = gate.syncState || window.click360GetSyncState?.({ reason: 'ui_conflict_modal' }) || {};\n\t\t    let localProds = 0, localSales = 0, localMovs = 0, hasMeaningfulLocalData = false;\n\t\t    try {\n\t\t      const biz = currentBusiness();\n\t\t      const bizId = biz?.id || state?.activeBusinessId;\n\t\t      localProds = (state?.products || []).filter(p => p.businessId === bizId).length;\n\t\t      localSales = (state?.sales || []).filter(s => s.businessId === bizId).length;\n\t\t      localMovs  = (state?.movements || []).filter(m => m.businessId === bizId).length;\n\t\t      hasMeaningfulLocalData = localProds > 0 || localSales > 0;\n\t\t    } catch(e) { console.warn('sync conflict counts:', e); }\n\t\t    showModal(`"""

new_sync_block = """\t\t  function localBusinessSyncStats() {\n\t\t    try {\n\t\t      const biz = currentBusiness();\n\t\t      const bizId = biz?.id || state?.activeBusinessId;\n\t\t      const products = (state?.products || []).filter(p => p.businessId === bizId).length;\n\t\t      const sales = (state?.sales || []).filter(s => s.businessId === bizId).length;\n\t\t      const movements = (state?.movements || []).filter(m => m.businessId === bizId).length;\n\t\t      return { businessId: bizId || '', products, sales, movements, meaningful: products > 0 || sales > 0 || movements > 0 };\n\t\t    } catch (error) {\n\t\t      console.warn('sync local stats:', error);\n\t\t      return { businessId: '', products: 0, sales: 0, movements: 0, meaningful: null };\n\t\t    }\n\t\t  }\n\t\t  window.click360GetLocalBusinessSyncStats = localBusinessSyncStats;\n\t\t  function showSyncConflictRecovery(gate = {}) {\n\t\t    const syncState = gate.syncState || window.click360GetSyncState?.({ reason: 'ui_conflict_modal' }) || {};\n\t\t    const localStats = localBusinessSyncStats();\n\t\t    const localProds = localStats.products;\n\t\t    const localSales = localStats.sales;\n\t\t    const localMovs = localStats.movements;\n\t\t    const hasMeaningfulLocalData = localStats.meaningful === true;\n\n\t\t    // A brand-new/empty device is not a real conflict. Never offer a destructive\n\t\t    // "keep local" path when it would mean pushing an empty tenant over cloud data.\n\t\t    if (localStats.meaningful === false) {\n\t\t      if (window.__CLICK360_EMPTY_LOCAL_RECOVERY_ACTIVE) return;\n\t\t      window.__CLICK360_EMPTY_LOCAL_RECOVERY_ACTIVE = true;\n\t\t      toast('Sincronizando los datos de tu negocio desde la nube...');\n\t\t      Promise.resolve(window.click360ResolveSyncConflict?.('refresh_cloud'))\n\t\t        .then((result) => {\n\t\t          if (result?.ok) {\n\t\t            closeModal(false);\n\t\t            renderApp(route);\n\t\t            toast('✅ Tus datos se actualizaron desde la nube.', 'ok');\n\t\t            return;\n\t\t          }\n\t\t          showModal(`<div class=\"modalHeader\"><div><h2>Sincronización pendiente</h2><p class=\"fieldHint\">Este dispositivo está vacío y no reemplazará los datos de la nube.</p></div><button class=\"closeBtn\" data-close aria-label=\"Cerrar\">×</button></div><div class=\"syncConflictPanel\"><p>Conéctate a internet y vuelve a intentar. Tus datos remotos permanecen protegidos.</p><button type=\"button\" class=\"btn primary block\" id=\"syncRetryEmptyLocal\">🔄 Reintentar desde nube</button></div>`);\n\t\t          $('#syncRetryEmptyLocal')?.addEventListener('click', () => { closeModal(false); showSyncConflictRecovery(gate); });\n\t\t        })\n\t\t        .catch((error) => {\n\t\t          console.warn('empty-local cloud recovery:', error);\n\t\t          toast('No se pudo actualizar desde nube. Tus datos remotos no fueron modificados.', 'err');\n\t\t        })\n\t\t        .finally(() => { window.__CLICK360_EMPTY_LOCAL_RECOVERY_ACTIVE = false; });\n\t\t      return;\n\t\t    }\n\t\t    showModal(`"""

replace_once('app.js', old_sync_block, new_sync_block, 'empty local sync recovery')

# 3) Defense-in-depth in Firebase conflict resolution: empty local must pull, never force-push.
old_resolver = """\t  window.click360ResolveSyncConflict = async function(action = 'cancel') {\n\t    if (action === 'refresh_cloud') return window.click360ClearLocalRecoveryState();\n\t    if (action === 'keep_local') {\n\t      clearSyncConflict();\n\t      LOCAL_WRITE_PENDING_UNTIL = Date.now() + PENDING_REMOTE_SYNC_GRACE_MS;\n\t      const saved = await pushLocalToFirestore('manual_keep_local', true); // force=true: user explicitly chose keep_local\n\t      return { ok: saved === true, action, syncState: getSyncState({ cleanup: true, reason: 'manual_keep_local_after' }) };\n\t    }\n\t    return { ok: false, action: 'cancelled', syncState: getSyncState({ cleanup: false, reason: 'manual_conflict_cancel' }) };\n\t  };"""

new_resolver = """\t  window.click360ResolveSyncConflict = async function(action = 'cancel') {\n\t    if (action === 'refresh_cloud') return window.click360ClearLocalRecoveryState();\n\t    if (action === 'keep_local') {\n\t      const localStats = window.click360GetLocalBusinessSyncStats?.();\n\t      if (localStats?.meaningful === false) {\n\t        console.warn('CLICK360 sync: blocked empty-local force write; refreshing from cloud instead.');\n\t        const result = await window.click360ClearLocalRecoveryState();\n\t        return { ...result, action: 'refresh_cloud_empty_local', preventedEmptyOverwrite: true };\n\t      }\n\t      clearSyncConflict();\n\t      LOCAL_WRITE_PENDING_UNTIL = Date.now() + PENDING_REMOTE_SYNC_GRACE_MS;\n\t      const saved = await pushLocalToFirestore('manual_keep_local', true);\n\t      if (saved !== true) {\n\t        return { ok: false, action, syncState: getSyncState({ cleanup: false, reason: 'manual_keep_local_failed' }) };\n\t      }\n\t      const readback = await pullRemoteOnce({ force: true, reload: false }).catch(() => false);\n\t      return { ok: readback === true, action, readback: readback === true, syncState: getSyncState({ cleanup: true, reason: 'manual_keep_local_after_readback' }) };\n\t    }\n\t    return { ok: false, action: 'cancelled', syncState: getSyncState({ cleanup: false, reason: 'manual_conflict_cancel' }) };\n\t  };"""

replace_once('firebase-service.js', old_resolver, new_resolver, 'empty-local overwrite guard + readback')

print('phase1 stability patch applied successfully')
