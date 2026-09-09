import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { readFileSync } from 'node:fs'

// 버전의 단일 출처는 package.json — 빌드 시 manifest.version 에 주입한다 (scripts/check-version.mjs 가 정합성 검사).
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

// MV3 익스텐션: 서비스 워커(ESM)와 옵션 페이지를 각각 엔트리로 빌드한다.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        options: resolve(__dirname, 'src/options/index.html'),
        popup: resolve(__dirname, 'src/popup/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'public/manifest.json',
          dest: '.',
          transform: (contents: string) => JSON.stringify({ ...JSON.parse(contents), version: pkg.version }, null, 2) + '\n',
        },
        { src: 'public/icons', dest: '.' },
      ],
    }),
  ],
  publicDir: false,
})
