#!/usr/bin/env node
/**
 * 버전 정합성 검사: package.json == public/manifest.json (== 태그, 인자로 주면).
 *   pnpm version:check [vX.Y.Z | refs/tags/vX.Y.Z]
 */
import { readFileSync } from 'node:fs'
import { isSemver, tagToVersion } from '../src/cli/version.ts'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'))
const problems = []

if (!isSemver(pkg.version)) problems.push(`package.json version is not semver: ${pkg.version}`)
if (manifest.version !== pkg.version) problems.push(`public/manifest.json version ${manifest.version} != package.json ${pkg.version}`)

const tag = process.argv[2]
if (tag) {
  try {
    const v = tagToVersion(tag)
    if (v !== pkg.version) problems.push(`tag ${tag} != package.json ${pkg.version}`)
  } catch (e) {
    problems.push(e.message)
  }
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`)
  process.exit(1)
}
console.log(`✓ version ${pkg.version}${tag ? ` (tag ${tag})` : ''}`)
