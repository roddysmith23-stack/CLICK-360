(function (root) {
  'use strict';
  // r37.2.1 (LIVE CLIENT RECOVERY -- safe update): the ONE real, shared
  // implementation of "update CLICK 360 without ever leaving the customer
  // with nothing". Before this file existed, THREE separate copies of
  // "update the app" existed: repair.html's own PREPARE->COMMIT->ROLLBACK
  // logic (the only correct one, r37.1/P0-A), plus two other ad-hoc
  // destroy-first copies (the access gate's "Actualizar archivos de la
  // app" and the boot-recovery screen's "Actualizar aplicacion") that
  // called the destroy-first pair (unregister the worker, then wipe every
  // cache) BEFORE ever confirming a new version could actually be
  // downloaded. If the network
  // dropped at that exact moment, the customer was left with NOTHING --
  // no service worker, no cache, and a reload with nothing to serve it.
  // That is the exact "No se puede acceder a este sitio" -> blank screen
  // a real customer (SHARY) hit after being told to "actualizar archivos
  // de la app".
  //
  // Self-contained on purpose: no dependency on app.js, Firebase Auth, or
  // tenant state -- this must keep working even when THOSE are the reason
  // CLICK 360 isn't opening, and it is loaded by the boot-recovery screen
  // before app.js is confirmed to have loaded at all.
  //
  // Contract: PREPARE (verify the network + a fresh manifest are really
  // reachable right now, touching nothing) -> COMMIT (let the browser's
  // own atomic service-worker install do its job -- a failed install
  // NEVER replaces the currently active worker, by spec) -> ROLLBACK (any
  // failure at any point leaves the existing worker/cache completely
  // untouched; the customer keeps using the app exactly as it was). This
  // function only ever resolves { ok:true } after a real, confirmed-active
  // new worker -- it never removes any existing registration or cache
  // itself.
  var UPDATE_TIMEOUT_MS = 20000;

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error(label + ' agotó el tiempo de espera.')); }, ms);
      promise.then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }

  // Resolves once `registration` has a genuinely active worker running the
  // latest install attempt -- whether that's a brand-new worker that just
  // finished installing, or (when update() found nothing new) the worker
  // that was already active. Rejects if the new worker fails and becomes
  // redundant, which the browser does WITHOUT touching the previous one.
  function waitForActiveWorker(registration) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(ok) {
        if (settled) return;
        settled = true;
        if (ok) resolve(); else reject(new Error('El nuevo service worker no pudo instalarse.'));
      }
      function track(worker) {
        if (!worker) return;
        if (worker.state === 'activated') return finish(true);
        if (worker.state === 'redundant') return finish(false);
        worker.addEventListener('statechange', function () {
          if (worker.state === 'activated') finish(true);
          else if (worker.state === 'redundant') finish(false);
        });
      }
      registration.addEventListener('updatefound', function () { track(registration.installing); });
      if (registration.installing) track(registration.installing);
      else if (registration.waiting) track(registration.waiting);
      else if (registration.active) finish(true); // update() found nothing new -- already current.
    });
  }

  // options.onLog(message): optional progress callback, UI-agnostic.
  // Returns a Promise resolving to either { ok:true, version } or
  // { ok:false, reason, message } -- NEVER rejects, NEVER throws past this
  // boundary, and NEVER touches the existing worker/cache on failure.
  root.click360SafeUpdate = function (options) {
    options = options || {};
    var onLog = typeof options.onLog === 'function' ? options.onLog : function () {};
    return new Promise(function (resolve) {
      if (!navigator.onLine) {
        resolve({ ok: false, reason: 'offline', message: 'No pudimos actualizar ahora: sin conexión. Puedes seguir trabajando con tu versión actual.' });
        return;
      }
      onLog('Verificando que la nueva versión esté disponible...');
      // PREPARE -- prove the network + server are really serving fresh
      // content right now, before touching anything.
      fetch('./release-manifest.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('El servidor respondió con un error (' + response.status + ').');
          return response.json();
        })
        .then(function (manifest) {
          if (!manifest || !manifest.version) throw new Error('La respuesta del servidor no fue válida.');
          onLog('Nueva versión disponible: ' + manifest.version);
          // COMMIT -- let the browser's own atomic install do the real work.
          if (!('serviceWorker' in navigator)) return manifest.version; // Nothing to update safely; caller may still proceed to open the app.
          return navigator.serviceWorker.getRegistration().then(function (existingReg) {
            if (existingReg) {
              onLog('Actualizando el service worker...');
              var ready = waitForActiveWorker(existingReg);
              return withTimeout(existingReg.update().then(function () { return ready; }), UPDATE_TIMEOUT_MS, 'La actualización')
                .then(function () { return manifest.version; });
            }
            onLog('Registrando el service worker...');
            return withTimeout(
              navigator.serviceWorker.register('./service-worker.js').then(waitForActiveWorker),
              UPDATE_TIMEOUT_MS, 'El registro'
            ).then(function () { return manifest.version; });
          });
        })
        .then(function (version) {
          onLog('Actualización lista.');
          resolve({ ok: true, version: version });
        })
        .catch(function (error) {
          // ROLLBACK -- nothing was touched; the caller's existing
          // worker/cache is exactly as it was.
          resolve({ ok: false, reason: 'error', message: 'No pudimos actualizar ahora: ' + (error && error.message || error) + '.' });
        });
    });
  };
})(typeof window !== 'undefined' ? window : this);
