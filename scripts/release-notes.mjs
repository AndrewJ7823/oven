#!/usr/bin/env node
/**
 * CHANGELOG.md 에서 해당 버전 섹션을 꺼내 release/NOTES.md 로 저장한다 (GitHub Release 본문용).
 *   node scripts/release-notes.mjs v1.0.0
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extractChangelogSection, tagToVersion } from '../src/cli/version.ts'

const tag = process.argv[2]
if (!tag) {
  console.error('사용법: node scripts/release-notes.mjs vX.Y.Z')
  process.exit(2)
}
const version = tagToVersion(tag)
const notes = extractChangelogSection(readFileSync('CHANGELOG.md', 'utf8'), version) ?? '- (CHANGELOG 에 항목 없음)'
mkdirSync('release', { recursive: true })
writeFileSync(
  'release/NOTES.md',
  `${notes}\n\n---\n**설치**: 첨부된 zip 을 풀고 \`chrome://extensions\` → 개발자 모드 ON → **압축해제된 확장 프로그램을 로드** → 푼 폴더 선택.\n`,
)
console.log(`✓ release/NOTES.md (${version})`)
