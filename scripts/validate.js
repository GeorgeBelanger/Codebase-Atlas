#!/usr/bin/env node
const { prepareData } = require('./data');
try {
    const { data, warnings } = prepareData(process.argv[2], { repo: process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : undefined });
    warnings.forEach(w => console.log('warn ' + w));
    console.log(`PASS — ${data.N.length} blocks, ${data.E.length} edges, ${data.JOURNEYS.length} journeys`);
}
catch (e) {
    console.error('FAIL — ' + e.message);
    process.exitCode = 1;
}
