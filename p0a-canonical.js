(function(root){
'use strict';
  const isPlain = value => value && Object.getPrototypeOf(value) === Object.prototype;
  function canonical(value) {
    if(value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if(typeof value === 'number' && Number.isFinite(value)) return value;
    if(Array.isArray(value)) return value.map(canonical);
    if(isPlain(value)) return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
    throw Error('MIGRATION_EXPLICIT_JSON_TYPES_REQUIRED');
  }
  const json = value => JSON.stringify(canonical(value));
  const bytes = value => new TextEncoder().encode(json(value)).length;
  async function hash(value) {
    const digest=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(json(value)));
    return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
root.CLICK360_P0A_CANONICAL=Object.freeze({canonicalJson:json,byteLength:bytes,hash});
})(typeof window==='undefined'?globalThis:window);
