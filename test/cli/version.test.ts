import { describe, it, expect } from 'vitest'
import { isSemver, bumpVersion, compareSemver, updateChangelog, extractChangelogSection, tagToVersion } from '../../src/cli/version'

describe('릴리스 — semver 유틸', () => {
  it.each(['1.0.0', '0.1.0', '10.20.30', '1.0.0-rc.1'])('%s 는 유효한 semver', (v) => expect(isSemver(v)).toBe(true))
  it.each(['1.0', 'v1.0.0', '1.0.0.0', 'abc', '', '01.0.0'])('%s 는 유효하지 않음', (v) => expect(isSemver(v)).toBe(false))

  it.each([
    ['1.2.3', 'patch', '1.2.4'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'major', '2.0.0'],
    ['1.2.3-rc.1', 'patch', '1.2.3'],
    ['1.2.3', '2.0.0', '2.0.0'],
  ] as const)('bumpVersion(%s, %s) → %s', (cur, kind, expected) => {
    expect(bumpVersion(cur, kind)).toBe(expected)
  })
  it('명시 버전이 현재보다 낮거나 같으면 예외', () => {
    expect(() => bumpVersion('1.2.3', '1.2.3')).toThrow(/greater/)
    expect(() => bumpVersion('1.2.3', '1.0.0')).toThrow(/greater/)
  })
  it('잘못된 입력은 예외', () => {
    expect(() => bumpVersion('1.2.3', 'huge' as never)).toThrow(/patch\|minor\|major/)
    expect(() => bumpVersion('x', 'patch')).toThrow(/semver/)
  })
  it('compareSemver 는 숫자 기준으로 비교한다 (10 > 9)', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
  })
  it('tagToVersion 은 v 접두어를 제거하고 형식을 검사한다', () => {
    expect(tagToVersion('v1.2.3')).toBe('1.2.3')
    expect(tagToVersion('refs/tags/v1.2.3')).toBe('1.2.3')
    expect(() => tagToVersion('release-1')).toThrow(/vX\.Y\.Z/)
  })
})

const CHANGELOG = `# Changelog

## [Unreleased]

### Added
- 새 기능

## [1.0.0] - 2026-09-09

### Added
- 최초 릴리스
`

describe('릴리스 — CHANGELOG', () => {
  it('Unreleased 항목을 새 버전 섹션으로 옮기고 빈 Unreleased 를 남긴다', () => {
    const out = updateChangelog(CHANGELOG, '1.1.0', '2026-10-01')
    expect(out).toContain('## [Unreleased]\n\n## [1.1.0] - 2026-10-01\n\n### Added\n- 새 기능\n')
    expect(out).toContain('## [1.0.0] - 2026-09-09')
  })
  it('Unreleased 가 비어 있으면 자리표시 항목을 넣는다', () => {
    const out = updateChangelog('# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-09-09\n\n- x\n', '1.0.1', '2026-10-01')
    expect(out).toMatch(/## \[1\.0\.1\] - 2026-10-01\n\n- 변경 사항 없음/)
  })
  it('Unreleased 섹션이 없으면 예외', () => {
    expect(() => updateChangelog('# Changelog\n', '1.0.1', '2026-10-01')).toThrow(/Unreleased/)
  })
  it('extractChangelogSection 은 해당 버전 본문만 돌려준다', () => {
    expect(extractChangelogSection(CHANGELOG, '1.0.0')).toBe('### Added\n- 최초 릴리스')
    expect(extractChangelogSection(CHANGELOG, '9.9.9')).toBeNull()
  })
})
