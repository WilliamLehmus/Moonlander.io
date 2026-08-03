import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  envDir: '../', // Load root .env file
  server: {
    port: 5173,
  }
});
