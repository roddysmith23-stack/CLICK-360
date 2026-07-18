'use strict';

const fs = require('node:fs');
const path = require('node:path');

function writeReport(report, outputPath = 'qa/reports/latest-business-simulator-report.json') {
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  return target;
}

module.exports = { writeReport };
