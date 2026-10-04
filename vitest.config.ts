import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Exists only inside a Vite build; see the stub's header.
      'virtual:pwa-register': resolve(__dirname, 'tests/helpers/pwaRegisterStub.ts'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __GIT_HASH__: JSON.stringify('test'),
    __BUILD_TIME__: JSON.stringify('test'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
