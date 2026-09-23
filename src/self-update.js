/** @typedef {import('./run.js').Runner} Runner */
/** @typedef {{ major: number, minor: number, patch: number, prerelease: string | null }} ParsedVersion */

const PACKAGE_NAME = 'bmad-method'
const NPM_VIEW_TIMEOUT_MS = 5000
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * @param {string} version
 * @returns {'next' | 'latest'}
 */
export function distTag(version) {
  return VERSION_PATTERN.exec(version)?.[4] ? 'next' : 'latest'
}

/**
 * @param {string} value
 * @returns {ParsedVersion | null}
 */
function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function comparePrerelease(a, b) {
  const left = a.split('.')
  const right = b.split('.')
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const one = left[index]
    const other = right[index]
    if (one === undefined) return -1
    if (other === undefined) return 1
    if (one === other) continue
    const numeric = /^\d+$/.test(one) && /^\d+$/.test(other)
    return numeric ? Number(one) - Number(other) : one < other ? -1 : 1
  }
  return 0
}

/**
 * @param {ParsedVersion} a
 * @param {ParsedVersion} b
 * @returns {number}
 */
function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * @param {{ runner: Runner, version: string, timeoutMs?: number }} deps
 * @returns {Promise<string | null>}
 */
export async function newerVersion(deps) {
  const { runner, version, timeoutMs = NPM_VIEW_TIMEOUT_MS } = deps
  const ours = parseVersion(version)
  if (!ours) return null
  try {
    const result = await runner({
      argv: ['npm', 'view', `${PACKAGE_NAME}@${distTag(version)}`, 'version'],
      timeoutMs,
    })
    if (result.timedOut || result.code !== 0) return null
    const latest = result.stdout.trim()
    const parsed = parseVersion(latest)
    if (!parsed) return null
    return compareVersions(parsed, ours) > 0 ? latest : null
  } catch {
    return null
  }
}
