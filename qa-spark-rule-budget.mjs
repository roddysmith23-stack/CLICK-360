import {readFile} from 'node:fs/promises';
const log=await readFile('firestore-debug.log','utf8');
if(/maximum of 1000 expressions|maximum.*document access|too many.*(access|calls)/i.test(log))throw Error('SPARK_RULES_EVALUATION_BUDGET_EXCEEDED');
console.log('PASS Spark candidate Rules evaluation budget: no expression/access-limit errors in emulator log');
