import {mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(`${root}functions/generated`,{recursive:true});
await copyFile(`${root}cloud-safety-backup.js`,`${root}functions/generated/cloud-safety-backup.cjs`);
