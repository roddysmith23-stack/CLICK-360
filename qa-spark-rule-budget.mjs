import {readFile} from 'node:fs/promises';
const log=await readFile('firestore-debug.log','utf8');
if(/ternary operator predicate is always boolean|java\.lang\.IllegalStateException/i.test(log))throw Error('SPARK_RULES_INTERNAL_EVALUATOR_FAILURE');
if(/maximum of 1000 expressions|maximum.*document access|too many.*(access|calls)/i.test(log))throw Error('SPARK_RULES_EVALUATION_BUDGET_EXCEEDED');
console.log('PASS Spark candidate Rules evaluation budget: no expression/access-limit errors in emulator log');
