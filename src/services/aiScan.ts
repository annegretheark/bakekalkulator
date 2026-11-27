// AI-skanning via Supabase Edge Function «ai-scan». Ingen API-nøkler i
// nettleseren: funksjonen kontrollerer innlogging, organisasjon og kvote.
// Bildet komprimeres her før det sendes, og lagres ikke noe sted.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiResult, ScanKind } from '../../supabase/functions/_shared/aiScan'

export type { AiIngredient, AiReceipt, AiRecipe, AiResult, ScanKind } from '../../supabase/functions/_shared/aiScan'

/** Lengste side etter komprimering (piksler). Nok til å lese tekst, lite nok til å holde kostnaden nede. */
export const MAX_IMAGE_SIDE = 1600
/** Maks størrelse som sendes (byte). Serveren har sin egen grense. */
export const MAX_UPLOAD_BYTES = 1_400_000

export interface AiStatus {
  enabled: boolean
  used: number
  limit: number
  resetsAt: string | null
}

export interface AiQuota { used: number; limit: number }

const MESSAGES: Record<string, string> = {
  AI_DISABLED: 'AI-tolkning er ikke slått på ennå. Bruk tekstgjenkjenning på telefonen i stedet.',
  QUOTA_EXCEEDED: 'Dere har brukt alle AI-skanningene for denne måneden. Tekstgjenkjenning på telefonen virker fortsatt.',
  RATE_LIMITED: 'Mange skanninger på kort tid. Vent et minutt og prøv igjen.',
  COST_LIMIT: 'AI-tolkning er midlertidig stengt. Bruk tekstgjenkjenning på telefonen i stedet.',
  FORBIDDEN: 'Du har ikke tilgang til denne organisasjonen.',
  NOT_AUTHENTICATED: 'Logg inn på nytt for å bruke AI-tolkning.',
  IMAGE_TOO_LARGE: 'Bildet er for stort. Prøv et nytt bilde.',
  INVALID_IMAGE: 'Bildet kunne ikke leses. Prøv et nytt bilde (JPG eller PNG).',
  INVALID_MEDIA_TYPE: 'Bildet kunne ikke leses. Prøv et nytt bilde (JPG eller PNG).',
  REFUSED: 'AI-en kunne ikke tolke dette bildet. Prøv et annet bilde.',
  TOO_LONG: 'Dokumentet var for langt til å tolkes på én gang. Ta bilde av én side om gangen.',
  NO_RESULT: 'Fant ingenting å hente ut. Prøv et skarpere bilde.',
  INVALID_RESULT: 'Svaret fra AI-en var ufullstendig. Prøv igjen.',
  PROVIDER_BUSY: 'AI-tjenesten er opptatt. Prøv igjen om litt.',
}

export class AiScanError extends Error {
  code: string
  constructor(code: string) {
    super(MESSAGES[code] ?? 'AI-tolkningen feilet. Prøv igjen, eller bruk tekstgjenkjenning på telefonen.')
    this.code = code
  }
}

/** Ny størrelse som holder lengste side under `max` og beholder forholdet. */
export function scaledSize(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (!(longest > max)) return { width, height }
  const f = max / longest
  return { width: Math.max(1, Math.round(width * f)), height: Math.max(1, Math.round(height * f)) }
}

/** Komprimerer bildet til JPEG (orientering fra EXIF tas med). Gir base64 uten prefiks. */
export async function compressImage(file: Blob): Promise<{ base64: string; mediaType: 'image/jpeg'; bytes: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    let side = MAX_IMAGE_SIDE
    for (let attempt = 0; attempt < 4; attempt++) {
      const { width, height } = scaledSize(bitmap.width, bitmap.height, side)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new AiScanError('INVALID_IMAGE')
      ctx.drawImage(bitmap, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', attempt < 2 ? 0.82 : 0.7))
      if (!blob) throw new AiScanError('INVALID_IMAGE')
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return { base64: await blobToBase64(blob), mediaType: 'image/jpeg', bytes: blob.size }
      }
      side = Math.round(side * 0.8)
    }
    throw new AiScanError('IMAGE_TOO_LARGE')
  } finally {
    bitmap.close()
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export async function getAiStatus(client: SupabaseClient, organizationId: string): Promise<AiStatus> {
  const { data, error } = await client.rpc('get_ai_status', { org: organizationId })
  // Før fase 3-migrasjonen finnes ikke funksjonen: AI er da av
  if (error || !data) return { enabled: false, used: 0, limit: 0, resetsAt: null }
  const d = data as { enabled?: boolean; used?: number; limit?: number; resets_at?: string }
  return { enabled: !!d.enabled, used: Number(d.used) || 0, limit: Number(d.limit) || 0, resetsAt: d.resets_at ?? null }
}

/** Sender ett bilde til AI-tolkning. Kaster AiScanError med norsk melding ved feil. */
export async function aiScan(client: SupabaseClient, organizationId: string, kind: ScanKind, file: Blob): Promise<{ result: AiResult; quota: AiQuota }> {
  const image = await compressImage(file)
  const { data, error } = await client.functions.invoke('ai-scan', {
    body: { organizationId, kind, image: image.base64, mediaType: image.mediaType },
  })
  if (error) {
    let code = 'UNKNOWN'
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try { code = ((await ctx.json()) as { error?: string }).error ?? code } catch { /* ukjent svar */ }
    }
    throw new AiScanError(code)
  }
  const d = data as { result?: AiResult; quota?: AiQuota }
  if (!d?.result) throw new AiScanError('NO_RESULT')
  return { result: d.result, quota: d.quota ?? { used: 0, limit: 0 } }
}
