import { defineConfig } from 'vitest/config';

/** GitHub Pages の公開パス: https://funny231217.github.io/giant-mino/ */
const PAGES_BASE = '/giant-mino/';

// 本番ビルドと vite preview は /giant-mino/ 配下（GitHub Pages と同じパス構成）、
// 開発サーバーは従来どおり http://localhost:5173/ で動かす
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? PAGES_BASE : '/',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  test: {
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
  },
}));
