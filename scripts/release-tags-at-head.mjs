/**
 * Release git tags at HEAD: @nodejs-db-migration-lock/<pkg>@<semver>
 */
import { execSync } from 'node:child_process';

export const SCOPE_PREFIX = '@nodejs-db-migration-lock/';

export function parseReleaseTag(tag) {
  if (!tag || !tag.startsWith(SCOPE_PREFIX)) {
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
  return { name, version, tag: `${name}@${version}` };
}

export function tagsAtHead() {
  const out = execSync('git tag --points-at HEAD', { encoding: 'utf8' }).trim();
  if (!out) {
    return [];
  }
  return out.split('\n').filter(Boolean);
}

/**
 * Tags to stage/build in this run.
 * - CI tag push: GITHUB_REF_NAME → only that package (even if more tags point at HEAD).
 * - Local: RELEASE_TAG for one package, or STAGE_ALL_TAGS=1 for every tag at HEAD.
 * - Default local: all release tags at HEAD.
 */
export function releaseTagsForRun() {
  const headTags = tagsAtHead();
  const atHead = new Set(headTags);
  const parsedAtHead = headTags.map(parseReleaseTag).filter(Boolean);

  const trigger =
    process.env.RELEASE_TAG?.trim() ||
    process.env.GITHUB_REF_NAME?.trim() ||
    '';

  const parsedTrigger = parseReleaseTag(trigger);
  if (parsedTrigger) {
    try {
      execSync(`git rev-parse ${JSON.stringify(`${parsedTrigger.tag}^{commit}`)}`, {
        stdio: 'ignore',
      });
    } catch {
      throw new Error(`Release tag ${parsedTrigger.tag} was not found in this clone.`);
    }
    return [parsedTrigger];
  }

  if (process.env.STAGE_ALL_TAGS === '1') {
    return parsedAtHead;
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    throw new Error(
      'Expected GITHUB_REF_NAME to be a release tag in Actions. Push one package tag per workflow run.',
    );
  }

  return parsedAtHead;
}

/** @returns {string[]} npm package names for this release run */
export function releasePackageNamesForRun() {
  const seen = new Set();
  const names = [];
  for (const { name } of releaseTagsForRun()) {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
