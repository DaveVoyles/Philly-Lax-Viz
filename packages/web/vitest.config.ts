import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    alias: {
      'pixi.js': resolve(__dirname, 'src/__mocks__/pixi.ts'),
    },
  },
});
