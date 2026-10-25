#!/usr/bin/env node
/**
 * Stage tagged packages for npm review (stage-only tokens).
 * Tag format: @nodejs-db-migration-lock/<pkg>@<semver>
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseTagsForRun } from './release-tags-at-head.mjs';

function npmSupportsStage() {
  try {
    execSync('npm stage --help', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function loadLernaPackages() {
  const json = execSync('npx lerna list --json --all --no-private', {
    encoding: 'utf8',
  });
  return JSON.parse(json);
}

function isPublishedOnNpm(name, version) {
  try {
    const out = execFileSync(
      'npm',
      ['view', `${name}@${version}`, 'version'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    return out === version;
  } catch {
    return false;
  }
}

if (!npmSupportsStage()) {
  console.error(
    'npm stage is unavailable. Use npm >= 11.15.0 (see package.json engines).',
  );
  process.exit(1);
}

let tags;
try {
  tags = releaseTagsForRun();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (tags.length === 0) {
  console.log('No release tags selected for this run; nothing to stage.');
  process.exit(0);
}

const byName = new Map(
  loadLernaPackages().map((pkg) => [pkg.name, pkg.location]),
);

const staged = [];
const skipped = [];

for (const { name, version, tag } of tags) {
  const location = byName.get(name);
  if (!location) {
    console.error(`No workspace package for tag ${tag}`);
    process.exit(1);
  }

  const manifest = JSON.parse(
    readFileSync(join(location, 'package.json'), 'utf8'),
  );
  if (manifest.version !== version) {
    console.error(
      `${name}: tag version ${version} != package.json ${manifest.version}`,
    );
    process.exit(1);
  }

  if (isPublishedOnNpm(name, version)) {
    console.log(`Skip ${tag} (already published on npm).`);
    skipped.push(tag);
    continue;
  }

  console.log(`Staging ${tag} from ${location}`);
  try {
    execFileSync('npm', ['stage', 'publish'], {
      cwd: location,
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    staged.push(tag);
  } catch (err) {
    const msg = `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`;
    if (msg.includes('E409') || msg.includes('previously published')) {
      console.log(`Skip ${tag} (already on npm registry).`);
      skipped.push(tag);
      continue;
    }
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    process.exit(err.status ?? 1);
  }
}

if (staged.length === 0 && skipped.length > 0) {
  console.log('\nNothing new to stage (all selected versions already on npm).');
  process.exit(0);
}

if (staged.length === 0) {
  console.log('\nNo packages staged.');
  process.exit(0);
}

console.log('\nStaged for review (not live on npm until approved):');
for (const id of staged) {
  console.log(`  - ${id}`);
}
console.log('\nMaintainer: npm stage list');
console.log('Promote:    npm stage approve <package>@<version> --otp <code>');
