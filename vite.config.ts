import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_REPOSITORY ? '/vetoliigan-kisaveikkaus-2026/' : '/',
  plugins: [react()],
})
