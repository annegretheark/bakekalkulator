import { defineConfig } from "cf/config";

// Rett i lomma – Bakekalkulator på Cloudflare Workers (Static Assets).
// Ren klientapp: ingen Worker-kode, kun statiske filer. Supabase-adresse og
// offentlig nøkkel bakes inn ved bygg fra .env.local (VITE_-variabler).
export default defineConfig({
  worker: {
    "name": "bakekalkulator",
    "compatibilityDate": "2026-09-21",
    "observability": {
      "enabled": true
    },
    "assets": {
      "notFoundHandling": "single-page-application"
    },
    // Eget domene i rettilomma.com-sonen (DNS og SSL opprettes av Cloudflare)
    "domains": ["bakekalkulator.rettilomma.com"]
  }
});
