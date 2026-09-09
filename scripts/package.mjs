#!/usr/bin/env node
/**
 * dist/ 를 배포용 zip 으로 묶는다 (Chrome "압축해제된 확장 프로그램 로드" 또는 웹 스토어 업로드용).
 *   pnpm package   → release/oven-vX.Y.Z.zip
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
if (!existsSync('dist/manifest.json')) {
  console.error('✗ dist/ 가 없습니다. 먼저 pnpm build 를 실행하세요.')
  process.exit(1)
}
const built = JSON.parse(readFileSync('dist/manifest.json', 'utf8')).version
if (built !== version) {
  console.error(`✗ dist/manifest.json version ${built} != package.json ${version}. 다시 빌드하세요.`)
  process.exit(1)
}
mkdirSync('release', { recursive: true })
const out = `release/oven-v${version}.zip`
rmSync(out, { force: true })
execSync(`cd dist && zip -qr "../${out}" . -x ".DS_Store"`, { stdio: 'inherit' })
console.log(`✓ ${out}`)
