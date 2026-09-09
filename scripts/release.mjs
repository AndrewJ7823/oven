#!/usr/bin/env node
/**
 * 릴리스 준비: 버전 올리기 → CHANGELOG 갱신 → 검사 → 커밋 → 태그.
 *   pnpm release <patch|minor|major|X.Y.Z> [--no-verify] [--dry-run]
 * 태그를 push 하면 GitHub Actions(release.yml)가 빌드·zip·Release 생성을 맡는다:
 *   git push origin main --follow-tags
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { bumpVersion, updateChangelog } from '../src/cli/version.ts'

const args = process.argv.slice(2)
const kind = args.find((a) => !a.startsWith('--'))
const dryRun = args.includes('--dry-run')
const verify = !args.includes('--no-verify')
if (!kind) {
  console.error('사용법: pnpm release <patch|minor|major|X.Y.Z> [--no-verify] [--dry-run]')
  process.exit(2)
}

const sh = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim()
const run = (cmd) => {
  console.log(`$ ${cmd}`)
  if (!dryRun) execSync(cmd, { stdio: 'inherit' })
}

const pkgPath = 'package.json'
const manifestPath = 'public/manifest.json'
const changelogPath = 'CHANGELOG.md'

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const next = bumpVersion(pkg.version, kind)
const today = new Date().toISOString().slice(0, 10)
console.log(`릴리스 ${pkg.version} → ${next} (${today})${dryRun ? ' [dry-run]' : ''}`)

if (sh('git status --porcelain')) {
  if (!dryRun) {
    console.error('✗ 작업 트리가 깨끗하지 않습니다. 먼저 커밋하거나 stash 하세요.')
    process.exit(1)
  }
  console.warn('! 작업 트리가 깨끗하지 않습니다 (dry-run 이라 계속).')
}
if (sh('git branch --show-current') !== 'main') console.warn('! main 브랜치가 아닙니다.')
if (sh(`git tag -l v${next}`)) {
  console.error(`✗ 태그 v${next} 가 이미 있습니다.`)
  process.exit(1)
}

if (verify) {
  run('pnpm typecheck')
  run('pnpm test')
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const changelog = updateChangelog(readFileSync(changelogPath, 'utf8'), next, today)
if (!dryRun) {
  writeFileSync(pkgPath, JSON.stringify({ ...pkg, version: next }, null, 2) + '\n')
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: next }, null, 2) + '\n')
  writeFileSync(changelogPath, changelog)
}
run('pnpm version:check')
run(`git add ${pkgPath} ${manifestPath} ${changelogPath}`)
run(`git commit -m "chore: release v${next}"`)
run(`git tag -a v${next} -m "v${next}"`)

console.log(`
✓ v${next} 커밋·태그 완료. 배포하려면:
    git push origin main --follow-tags
  → GitHub Actions 가 빌드 후 Release 에 oven-v${next}.zip 을 올립니다.`)
