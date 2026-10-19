import assert from 'node:assert/strict';
import {failureReason,runClientSuite} from './qa-spark-emulator-health.mjs';
assert.equal(failureReason('PERMISSION_DENIED: false for create'),null);
assert.equal(failureReason('maximum of 1000 expressions'),'SPARK_RULES_EVALUATION_BUDGET_EXCEEDED');
assert.equal(failureReason('java.lang.IllegalStateException: ternary operator predicate is always boolean'),'SPARK_RULES_INTERNAL_EVALUATOR_FAILURE');
await runClientSuite(['./qa-spark-modular-rules.mjs','./qa-spark-recovery-copy-rules.mjs','./qa-spark-modular-importer.mjs','./qa-spark-operational-client-rules.mjs','./qa-spark-historical-readonly-rules.mjs','./qa-spark-sale-cancellation-client-rules.mjs','./qa-spark-retail-report-client.mjs']);
