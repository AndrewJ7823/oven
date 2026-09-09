# README 스크린샷 재생성

`docs/screenshots/*.png` 는 실제 빌드 산출물(`dist/`)의 팝업·옵션 페이지를 `chrome.*` 목과 함께 렌더링해 찍은 것이다.

```bash
pnpm build
DEMO=$(mktemp -d) && cp -R dist/ "$DEMO/" && cp scripts/screenshots/chrome-mock.js scripts/screenshots/terminal.html "$DEMO/"
for p in popup options; do
  sed "s#<script type=\"module\" crossorigin src=\"/$p.js\"></script>#<script src=\"/chrome-mock.js\"></script>&#" dist/src/$p/index.html > "$DEMO/$p.html"
done
(cd "$DEMO" && python3 -m http.server 8931 --bind 127.0.0.1)
```

그다음 브라우저(또는 Playwright)로 아래 페이지를 열어 뷰포트를 맞추고 저장한다.

| 파일 | 페이지 | 뷰포트 |
|---|---|---|
| `docs/screenshots/popup.png` | `http://127.0.0.1:8931/popup.html` | 340 × 185 |
| `docs/screenshots/options.png` | `http://127.0.0.1:8931/options.html` | 760 × 800 |
| `docs/screenshots/send-cli.png` | `http://127.0.0.1:8931/terminal.html` | 890 × 470 |

`chrome-mock.js` 의 설정·로그 값을 바꾸면 화면 내용이 바뀐다. 터미널 출력은 `terminal.html` 에 정적으로 적혀 있다(`pnpm send` 실제 출력과 문구를 맞춰 둔다).
