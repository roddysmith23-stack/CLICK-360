import fs from 'node:fs';
import process from 'node:process';

const STAGING_PROJECT = 'click360-staging-7620168025';
const PRODUCTION_PROJECT = 'click-360';
const configFile = process.env.CLICK360_STAGING_CONFIG || 'firebase.staging.json';
if (!['firebase.staging.json', 'firebase.spark-staging.json'].includes(configFile)) throw new Error('Unapproved staging configuration');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const rc = JSON.parse(fs.readFileSync('.firebaserc', 'utf8'));
const requestedProject = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.argv[2] || STAGING_PROJECT);

if (requestedProject === PRODUCTION_PROJECT || requestedProject !== STAGING_PROJECT) {
  throw new Error(`Staging guard rechazó el proyecto: ${requestedProject || '(vacío)'}`);
}
if (rc.projects?.staging !== STAGING_PROJECT) throw new Error('El alias staging no coincide con el proyecto aprobado.');
if (config.hosting?.site !== STAGING_PROJECT) throw new Error('El Hosting de staging no coincide con el proyecto aprobado.');
if (config.hosting?.site === PRODUCTION_PROJECT) throw new Error('La configuración staging apunta a producción.');
const expectedRules = configFile === 'firebase.spark-staging.json' ? 'firestore.spark.rules' : 'firestore.rules';
if (config.firestore?.rules !== expectedRules || !fs.existsSync(expectedRules)) throw new Error('Rules candidatas ausentes en staging.');
if (config.functions || config.storage || config.emulators) throw new Error('Staging release must contain Hosting and Firestore only');

console.log(`PASS staging target guard: ${STAGING_PROJECT}; production ${PRODUCTION_PROJECT} remains excluded`);
