// Skanning med telefonens kamera. Alt kjører i nettleseren:
//  * tekstgjenkjenning (OCR) med Tesseract – bildet sendes ikke til noen server
//  * strekkoder med nettleserens BarcodeDetector, eller en WebAssembly-versjon der den mangler
// Bibliotekene lastes først når de trengs, så de ikke gjør appen tregere å åpne.
import type { Unit } from '../types'

export interface OcrProgress {
  status: string
  progress: number // 0–1
}

/** Skalerer ned store kamerabilder. Gir raskere og ofte bedre tekstgjenkjenning. */
async function prepareImage(file: Blob, maxSide = 2200): Promise<Blob | HTMLCanvasElement> {
  if (typeof createImageBitmap !== 'function') return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.filter = 'grayscale(1) contrast(1.15)'
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  return canvas
}

const STATUS_TEXT: Record<string, string> = {
  'loading tesseract core': 'Laster tekstgjenkjenning …',
  'initializing tesseract': 'Starter tekstgjenkjenning …',
  'loading language traineddata': 'Laster norsk språkdata (første gang tar det litt tid) …',
  'initializing api': 'Gjør klar …',
  'recognizing text': 'Leser teksten …',
}

/** Leser tekst fra ett eller flere bilder (f.eks. en oppskrift over to sider). */
export async function recognizeText(files: Blob[], onProgress?: (p: OcrProgress) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  let index = 0
  const worker = await createWorker('nor', 1, {
    logger: (m) => {
      const base = files.length > 1 && m.status === 'recognizing text' ? ` (bilde ${index + 1} av ${files.length})` : ''
      onProgress?.({ status: (STATUS_TEXT[m.status] ?? 'Arbeider …') + base, progress: m.progress ?? 0 })
    },
  })
  try {
    const texts: string[] = []
    for (; index < files.length; index++) {
      const img = await prepareImage(files[index])
      const { data } = await worker.recognize(img)
      texts.push(data.text)
    }
    return texts.join('\n')
  } finally {
    await worker.terminate()
  }
}

// ---------- Strekkode ----------

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const

interface Detector { detect(src: ImageBitmapSource): Promise<{ rawValue: string }[]> }

async function getDetector(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: { new(o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
  if (native) {
    const supported = (await native.getSupportedFormats?.()) ?? []
    if (supported.includes('ean_13')) return new native({ formats: [...FORMATS] })
  }
  const { BarcodeDetector } = await import('barcode-detector/ponyfill')
  return new BarcodeDetector({ formats: [...FORMATS] })
}

/** Finner EAN-/UPC-koden i et bilde. Returnerer null hvis ingen kode ble funnet. */
export async function decodeBarcode(file: Blob): Promise<string | null> {
  const detector = await getDetector()
  const bmp = await createImageBitmap(file)
  try {
    const codes = await detector.detect(bmp)
    return codes.find((c) => /^\d{8,14}$/.test(c.rawValue))?.rawValue ?? null
  } finally {
    bmp.close?.()
  }
}

export interface ProductInfo {
  ean: string
  name: string
  brand: string
  packageSize: number | null
  unit: Unit | null
  category: string
}

/** Tolker «1 kg», «500 g», «1,75 l», «33 cl», «12 x 50 g». */
export function parseQuantity(q: string | undefined | null): { size: number; unit: Unit } | null {
  if (!q) return null
  const m = q.match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|dl|cl|ml|stk)\b/i)
  if (!m) return null
  let size = Number(m[2].replace(',', '.')) * (m[1] ? Number(m[1]) : 1)
  let unit = m[3].toLowerCase()
  if (unit === 'gr') unit = 'g'
  if (unit === 'cl') { size *= 10; unit = 'ml' }
  return size > 0 ? { size: Math.round(size * 1000) / 1000, unit: unit as Unit } : null
}

/**
 * Slår opp varen i Open Food Facts (åpen og gratis vareddatabase). Bare
 * strekkoden sendes. Databasen har ikke priser – prisen fyller brukeren inn.
 */
export async function lookupProduct(ean: string, fetchImpl: typeof fetch = fetch): Promise<ProductInfo | null> {
  if (!/^\d{8,14}$/.test(ean)) return null
  const url = `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_nb,product_name_no,brands,quantity,categories`
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const json = (await res.json()) as { status?: number; product?: Record<string, string | undefined> }
  const p = json.product
  if (json.status !== 1 || !p) return null
  const name = (p.product_name_nb || p.product_name_no || p.product_name || '').trim()
  if (!name) return null
  const q = parseQuantity(p.quantity)
  const category = (p.categories ?? '').split(',').map((c) => c.trim()).filter((c) => c && !c.includes(':')).pop() ?? ''
  return { ean, name, brand: (p.brands ?? '').split(',')[0].trim(), packageSize: q?.size ?? null, unit: q?.unit ?? null, category }
}
