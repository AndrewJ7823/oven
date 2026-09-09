/**
 * 릴리스 스크립트(`pnpm release`)의 순수 로직 — semver 증가, CHANGELOG 갱신/추출. I/O 는 scripts/release.mjs 가 담당한다.
 */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/

export type BumpKind = 'patch' | 'minor' | 'major'

export function isSemver(v: string): boolean {
  return SEMVER_RE.test(v)
}

function parts(v: string): { nums: [number, number, number]; pre: string | null } {
  const m = SEMVER_RE.exec(v)
  if (!m) throw new Error(`not a semver version: "${v}"`)
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null }
}

/** 숫자 기준 비교. 프리릴리스는 같은 숫자의 정식 버전보다 낮다. */
export function compareSemver(a: string, b: string): number {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < 3; i++) {
    const d = pa.nums[i]! - pb.nums[i]!
    if (d !== 0) return d
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  return pa.pre < pb.pre ? -1 : 1
}

/** `patch|minor|major` 또는 명시 버전(현재보다 커야 함)으로 다음 버전을 계산한다. */
export function bumpVersion(current: string, kind: BumpKind | string): string {
  const { nums, pre } = parts(current)
  const [major, minor, patch] = nums
  switch (kind) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      // 프리릴리스(1.2.3-rc.1)의 patch 는 정식 1.2.3 으로 확정
      return pre !== null ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`
    default:
      if (!isSemver(kind)) throw new Error(`version must be patch|minor|major or a semver string: "${kind}"`)
      if (compareSemver(kind, current) <= 0) throw new Error(`new version ${kind} must be greater than current ${current}`)
      return kind
  }
}

/** `v1.2.3` 또는 `refs/tags/v1.2.3` → `1.2.3` */
export function tagToVersion(tag: string): string {
  const m = /^(?:refs\/tags\/)?v(.+)$/.exec(tag)
  if (!m || !isSemver(m[1]!)) throw new Error(`tag must look like vX.Y.Z: "${tag}"`)
  return m[1]!
}

const UNRELEASED_RE = /^## \[Unreleased\][^\n]*\n/m
const SECTION_RE = /^## \[/m

/** Keep a Changelog 형식: Unreleased 본문을 `## [version] - date` 로 옮기고 빈 Unreleased 를 남긴다. */
export function updateChangelog(text: string, version: string, date: string): string {
  const m = UNRELEASED_RE.exec(text)
  if (!m) throw new Error('CHANGELOG.md has no "## [Unreleased]" section')
  const bodyStart = m.index + m[0].length
  const rest = text.slice(bodyStart)
  const next = SECTION_RE.exec(rest)
  const bodyEnd = next ? bodyStart + next.index : text.length
  const body = text.slice(bodyStart, bodyEnd).trim()
  const notes = body.length > 0 ? body : '- 변경 사항 없음'
  return `${text.slice(0, m.index)}## [Unreleased]\n\n## [${version}] - ${date}\n\n${notes}\n\n${text.slice(bodyEnd)}`.replace(/\n{3,}/g, '\n\n')
}

/** 해당 버전 섹션의 본문(제목 제외)을 돌려준다. 없으면 null. 릴리스 노트로 쓴다. */
export function extractChangelogSection(text: string, version: string): string | null {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const head = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n`, 'm').exec(text)
  if (!head) return null
  const start = head.index + head[0].length
  const rest = text.slice(start)
  const next = SECTION_RE.exec(rest)
  return rest.slice(0, next ? next.index : rest.length).trim()
}
