/**
 * qa-staging-seed-shary-scale.mjs -- CLICK360_SHARY_SCALE_QA fixture reset
 *
 * Deterministically RESETS the canonical SYNTHETIC QA staging tenant's
 * products array to exactly 436 synthetic products (matching SHARY's real
 * production product count, per the P0 mission's repro requirement) so the
 * staging repro exercises a comparably-sized state/main payload -- not a
 * toy fixture, and not an unbounded pile accumulated from repeated test
 * runs across a long session.
 *
 * STAGING ONLY (hardcoded project id). Writes only to the canonical
 * synthetic tenant's own state/main document. No SHARY data read or
 * touched -- no UID/email/data of any real customer is ever used here.
 *
 * Genuinely idempotent RESET (not a top-up): every run REPLACES the
 * products array with the same deterministic 436-entry set (ids
 * seed-prod-0000..seed-prod-0435, all fields derived only from the index),
 * discarding whatever extra products individual test runs created in the
 * meantime. Run this once before a verification pass to guarantee a known
 * baseline -- running it 10 times in a row always leaves exactly the same
 * 436 products, regardless of how much the tenant grew between runs.
 */
import { connectAdmin } from './lib/firebase-admin-connect.mjs';
import { createHash } from 'node:crypto';

const STAGING_PROJECT = 'click360-staging-7620168025';
const UID = '1dDPbpK5SncYDwdpbMBCvoUz2nl1';
const CANONICAL_PRODUCT_COUNT = 436;
const CANONICAL_CREATED_AT_MS = 1700000000000; // fixed, deterministic -- never Date.now()
const CONFIRMATION = '--confirm-click360-staging-fixture-reset';

if (!process.argv.includes(CONFIRMATION)) {
  throw new Error(`Refusing fixture reset without ${CONFIRMATION}`);
}

function buildCanonicalProducts() {
  const products = [];
  for (let index = 0; index < CANONICAL_PRODUCT_COUNT; index += 1) {
    products.push({
      id: `seed-prod-${index}`,
      businessId: UID,
      code: `SEED-${String(index).padStart(4, '0')}`,
      category: ['Ropa', 'Calzado', 'Accesorios', 'Hogar'][index % 4],
      name: `Producto sintetico de prueba ${index}`,
      qty: (index % 50) + 1,
      stock: (index % 50) + 1,
      cost: Number((3 + (index % 20) * 0.75).toFixed(2)),
      price: Number((8 + (index % 20) * 1.5).toFixed(2)),
      cardPrice: Number((8.5 + (index % 20) * 1.5).toFixed(2)),
      taxMode: 'inherit',
      notes: '',
      imageData: '',
      createdAt: new Date(CANONICAL_CREATED_AT_MS).toISOString(),
      createdAtMs: CANONICAL_CREATED_AT_MS,
      updatedAt: new Date(CANONICAL_CREATED_AT_MS).toISOString(),
      updatedAtMs: CANONICAL_CREATED_AT_MS,
      createdBy: 'qa-seed-shary-scale'
    });
  }
  return products;
}

async function main() {
  const db = await connectAdmin(STAGING_PROJECT, 'seed-shary-scale');
  const ref = db.collection('businesses').doc(UID).collection('state').doc('main');
  const canonicalProducts = buildCanonicalProducts();
  let existingCount = 0;
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error('Canonical staging tenant state/main does not exist -- run qa-staging-canonical-tenant.mjs first.');
    const data = snap.data();
    existingCount = (data.payload?.data?.products || []).length;
    const now = Date.now();
    const updated = {
      ...data,
      revision:now,
      updatedAtMs:now,
      updatedAt:new Date(now).toISOString(),
      payload:{
        ...data.payload,
        data:{ ...data.payload.data, products:canonicalProducts, updatedAtMs:now, updatedAt:new Date(now).toISOString() }
      }
    };
    transaction.update(ref, updated);
  });

  const verified = await ref.get();
  const data = verified.data();
  const finalProducts = data.payload?.data?.products || [];
  if (finalProducts.length !== CANONICAL_PRODUCT_COUNT) throw new Error(`Fixture verification failed: ${finalProducts.length} products`);
  const productHash = createHash('sha256').update(JSON.stringify(finalProducts)).digest('hex');

  const payloadBytes = Buffer.byteLength(JSON.stringify(data.payload), 'utf8');
  console.log(JSON.stringify({
    fixture: 'CLICK360_SHARY_SCALE_QA',
    reset: true,
    existingCountBeforeReset: existingCount,
    finalCount: finalProducts.length,
    productHash,
    payloadBytes, maxCloudPayloadBytes: 850000,
    percentOfCap: Math.round((payloadBytes / 850000) * 1000) / 10
  }, null, 2));
}

await main();
