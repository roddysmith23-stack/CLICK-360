const CLICK360_PRODUCTION_FIREBASE_CONFIG = {
    apiKey: "AIzaSyC0d-U6fvcYz7ohhMZXch69mf3j2TzwcSE",
    authDomain: window.location.hostname === "click-360.web.app" ? "click-360.web.app" : "click-360.firebaseapp.com",
    projectId: "click-360",
    storageBucket: "click-360.firebasestorage.app",
    messagingSenderId: "7620168025",
    appId: "1:7620168025:web:9fcbd907bd95ac938ce448"
  };

const CLICK360_STAGING_FIREBASE_CONFIG = {
  apiKey: "AIzaSyChokhxV1ivkoMZnWe3E3t-2C0S0ffdAcs",
  authDomain: "click360-staging-7620168025.firebaseapp.com",
  projectId: "click360-staging-7620168025",
  storageBucket: "click360-staging-7620168025.firebasestorage.app",
  messagingSenderId: "471043029016",
  appId: "1:471043029016:web:556e46fb8fdd48b95eeb6d"
};

const CLICK360_STAGING_HOSTS = new Set([
  'click360-staging-7620168025.web.app',
  'click360-staging-7620168025.firebaseapp.com',
  'localhost',
  '127.0.0.1'
]);
const CLICK360_IS_STAGING_HOST = CLICK360_STAGING_HOSTS.has(window.location.hostname)
  || window.location.hostname.startsWith('click360-staging-7620168025--');
window.CLICK360_FIREBASE_CONFIG = CLICK360_IS_STAGING_HOST
  ? CLICK360_STAGING_FIREBASE_CONFIG
  : CLICK360_PRODUCTION_FIREBASE_CONFIG;
