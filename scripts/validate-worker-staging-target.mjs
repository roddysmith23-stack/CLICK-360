import fs from 'node:fs';
import process from 'node:process';

const STAGING_PROJECT = 'click360-staging-7620168025';
const PRODUCTION_PROJECT = 'click-360';
const config = JSON.parse(fs.readFileSync('firebase.staging.json', 'utf8'));
const rc = JSON.parse(fs.readFileSync('.firebaserc', 'utf8'));
const requestedProject = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.argv[2] || STAGING_PROJECT);

if (requestedProject === PRODUCTION_PROJECT || requestedProject !== STAGING_PROJECT) {
  throw new Error(`Staging guard rechazó el proyecto: ${requestedProject || '(vacío)'}`);
}
if (rc.projects?.staging !== STAGING_PROJECT) throw new Error('El alias staging no coincide con el proyecto aprobado.');
if (config.hosting?.site !== STAGING_PROJECT) throw new Error('El Hosting de staging no coincide con el proyecto aprobado.');
if (config.hosting?.site === PRODUCTION_PROJECT) throw new Error('La configuración staging apunta a producción.');
if (config.firestore?.rules !== 'firestore.rules') throw new Error('Rules candidatas ausentes en staging.');

console.log(`PASS staging target guard: ${STAGING_PROJECT}; production ${PRODUCTION_PROJECT} remains excluded`);
