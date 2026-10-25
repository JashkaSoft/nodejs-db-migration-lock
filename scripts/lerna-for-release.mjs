#!/usr/bin/env node
/**
 * Run lerna build/test for packages in this release run (see release-tags-at-head.mjs).
 */
import { execFileSync } from 'node:child_process';
import { releasePackageNamesForRun } from './release-tags-at-head.mjs';

const task = process.argv[2];
if (task !== 'build' && task !== 'test') {
  console.error('Usage: node scripts/lerna-for-release.mjs <build|test>');
  process.exit(1);
}

let names;
try {
  names = releasePackageNamesForRun();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (names.length === 0) {
  console.error('No release packages selected for this run.');
  process.exit(1);
}

console.log(`Release ${task} for: ${names.join(', ')}`);

const args = ['lerna', 'run', task, ...names.flatMap((n) => ['--scope', n]), '--stream'];
if (task === 'build') {
  args.push('--include-dependencies');
}

execFileSync('npx', args, { stdio: 'inherit' });
