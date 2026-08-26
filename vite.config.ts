import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

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
      targets: [{ src: 'public/manifest.json', dest: '.' }, { src: 'public/icons', dest: '.' }],
    }),
  ],
  publicDir: false,
})
