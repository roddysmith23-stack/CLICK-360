// Canonical future modular contract. Not loaded by legacy production.
(function(root) {
  'use strict';
  const MiB=1024*1024;
  const FOUNDER_LEGACY=Object.freeze({policyVersion:1,businesses:2,workers:2,
    productsActive:2000,structuredStorageBytes:100*MiB,
    growthThresholdProducts:1200,capacityWarningProducts:1600,commercialReviewProducts:1900,
    includedProductsHardLimit:2000,storageTrackingBytes:75*MiB,storageWarningBytes:90*MiB});
  function inspect({productsActive,structuredUsage=null}) {
    if(!Number.isSafeInteger(productsActive)||productsActive<0)throw Error('INVALID_ACTIVE_PRODUCT_COUNT');
    const p=FOUNDER_LEGACY;
    const catalogLevel=productsActive>p.productsActive?'expansion_required':productsActive===p.productsActive?'included_capacity_reached'
      :productsActive>=p.commercialReviewProducts?'commercial_review':productsActive>=p.capacityWarningProducts?'capacity_warning'
      :productsActive>=p.growthThresholdProducts?'growth':'normal';
    // Informational until the authoritative aggregate and override source are certified.
    // Never gate cash, syncing, recovery or access on these thresholds.
    const measured=structuredUsage?.certified===true&&structuredUsage?.measurementVersion===1
      &&Number.isSafeInteger(structuredUsage.bytes)&&structuredUsage.bytes>=0;
    const bytes=measured?structuredUsage.bytes:null;
    return Object.freeze({policyVersion:1,catalogLevel,activeProducts:productsActive,
      includedProducts:p.productsActive,canAddWithinIncludedCapacity:productsActive<p.productsActive,
      cashBlocked:false,syncBlocked:false,storageEnforced:false,structuredUsageBytes:bytes,
      storageLevel:!measured?'unverified':bytes>=p.structuredStorageBytes?'included_capacity_reached'
        :bytes>=p.storageWarningBytes?'warning':bytes>=p.storageTrackingBytes?'tracking':'normal'});
  }
  root.CLICK360_MODULAR_CAPACITY_POLICY=Object.freeze({FOUNDER_LEGACY,inspect});
})(typeof window==='undefined'?globalThis:window);
