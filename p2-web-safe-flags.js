(() => {
  'use strict';

  // Static release gates. They are not an authorization mechanism and never grant cloud access.
  window.CLICK360_P2_WEB_SAFE_FLAGS = Object.freeze({
    p2UniversalLabelsEnabled: true,
    p2WorkersEnabled: false,
    p2RestaurantAdvancedEnabled: true,
    p2LogisticsEnabled: true,
    p2OwnerPreviewEnabled: false
  });
})();
