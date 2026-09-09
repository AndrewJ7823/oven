# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/),
버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따른다.
`## [Unreleased]` 아래에 변경을 적어 두면 `pnpm release` 가 다음 버전 섹션으로 옮긴다.

## [Unreleased]

## [1.0.0] - 2026-09-09

### Added
- `cookies.replace` 요청을 받아 Chrome 쿠키를 merge / replace 모드로 교체 (FR-03 ~ FR-09)
- 두 가지 수신 경로: `externally_connectable` 메시지(웹 앱), 로컬 WebSocket 클라이언트(데스크톱 앱) (FR-01, FR-02)
- 공유 토큰 인증, 도메인 허용 목록, 쿠키 단위 부분 실패 보고, dryRun (FR-04, FR-05, FR-08, FR-09)
- `open.url` 로 창 열기 → 쿠키 주입 → 새로고침 (FR-12)
- 툴바 팝업(빠른 제어판)과 연결 상태 뱃지, 옵션 페이지와 최근 처리 로그 (FR-11, FR-13)
- `pnpm send` CLI: 터미널에서 도메인과 쿠키를 지정해 전송 (FR-14)
- 버전 관리(`pnpm release`, `pnpm version:check`)와 GitHub Actions CI / Release 워크플로
