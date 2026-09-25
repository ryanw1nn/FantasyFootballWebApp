import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The API pins CORS to http://localhost:5173, so a dev server that quietly
  // moves to 5174 because 5173 was busy renders every table empty and reports
  // nothing. strictPort turns that silent afternoon into a startup error.
  server: {
    port: 5173,
    strictPort: true
  }
})
