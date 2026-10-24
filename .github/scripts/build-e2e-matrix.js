#!/usr/bin/env node
/**
 * Print a JSON array of matrix rows for the e2e job.
 * Usage: build-e2e-matrix.js <targets.json> <nodeVersion> all|filter pkg1,pkg2,...
 */
const fs = require('fs');

const [, , targetsPath, nodeVersion, mode, pkgList] = process.argv;
const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
const filter = mode === 'filter' ? new Set((pkgList || '').split(',').filter(Boolean)) : null;

const selected = targets.filter((target) => {
  if (!filter) {
    return true;
  }
  return target.packages.some((pkg) => filter.has(pkg));
});

const matrix = selected.map((target) => ({
  node: Number(nodeVersion),
  name: target.name,
  run: target.run,
  image_env: target.image_env,
  image: target.image,
}));

process.stdout.write(JSON.stringify(matrix));
