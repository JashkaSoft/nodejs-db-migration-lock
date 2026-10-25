#!/usr/bin/env node
/**
 * Stage tagged packages at HEAD for npm review (stage-only tokens).
 * Tag format: @nodejs-db-migration-lock/<pkg>@<semver>
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCOPE_PREFIX = '@nodejs-db-migration-lock/';

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function parseReleaseTag(tag) {
  if (!tag.startsWith(SCOPE_PREFIX)) {
    return null;
  }
  const at = tag.lastIndexOf('@');
  if (at <= 0) {
    return null;
  }
  const name = tag.slice(0, at);
  const version = tag.slice(at + 1);
  if (!name.startsWith(SCOPE_PREFIX) || !version) {
    return null;
  }
  return { name, version };
}

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

function tagsAtHead() {
  const out = execSync('git tag --points-at HEAD', { encoding: 'utf8' }).trim();
  if (!out) {
    return [];
  }
  return out.split('\n').filter(Boolean);
}

if (!npmSupportsStage()) {
  console.error(
    'npm stage is unavailable. Use npm >= 11.15.0 (see package.json engines).',
  );
  process.exit(1);
}

const tags = tagsAtHead()
  .map(parseReleaseTag)
  .filter(Boolean);

if (tags.length === 0) {
  console.log('No @nodejs-db-migration-lock/* release tags at HEAD; nothing to stage.');
  process.exit(0);
}

const byName = new Map(
  loadLernaPackages().map((pkg) => [pkg.name, pkg.location]),
);

const staged = [];
for (const { name, version } of tags) {
  const location = byName.get(name);
  if (!location) {
    console.error(`No workspace package for tag ${name}@${version}`);
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

  console.log(`Staging ${name}@${version} from ${location}`);
  run('npm', ['stage', 'publish'], { cwd: location });
  staged.push(`${name}@${version}`);
}

console.log('\nStaged for review (not live on npm until approved):');
for (const id of staged) {
  console.log(`  - ${id}`);
}
console.log('\nMaintainer: npm stage list');
console.log('Promote:    npm stage approve <package>@<version> --otp <code>');
