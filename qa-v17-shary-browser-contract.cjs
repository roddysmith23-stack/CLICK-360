const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('qa-v17-shary-browser-mirror.html', 'utf8');
assert(source.includes('qaMirrorBrowserV17'));
assert(source.includes('pro_lifetime'));
assert(source.includes("mode === 'lifetime'"));
assert(source.includes('trialDays: 7'));
assert(source.includes('CLICK360:V17:STATE:${uid}:${organizationId}'));
assert(source.includes('online_only_safe'));
assert(source.includes('QuotaExceededError'));
assert(source.includes('click360-v16-1-2'));
assert(source.includes('other-product-cache'));
assert(source.includes("window.addEventListener('offline'"));
assert(!source.includes('shary10mmvv@gmail.com'));
assert(!source.includes('3UTjgHd1QNSvqlcXNKQ6tL79X7u2'));

console.log('PASS V17 Shary browser mirror contract: lifetime, cache, storage, offline and isolated identity');
