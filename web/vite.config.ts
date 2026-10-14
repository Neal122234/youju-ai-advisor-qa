import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 可通过 VITE_BASE 配置（GitHub Pages 镜像用 `/仓库名/`），默认相对路径
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [react()],
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': { target: 'http://localhost:8788', changeOrigin: true } },
  },
});
