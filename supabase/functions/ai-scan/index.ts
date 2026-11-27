// Supabase Edge Function «ai-scan»: tolker ett bilde (oppskrift, kvittering/faktura
// eller produktetikett) med Claude og returnerer strukturerte data.
//
// Sikkerhet og kostnadskontroll:
//  * API-nøkkelen (ANTHROPIC_API_KEY) finnes bare her, som hemmelighet i Supabase.
//  * Krever innlogget bruker (JWT) og medlemskap i organisasjonen.
//  * Kvote per plan, hastighetsgrense og samlet kostnadstak håndheves i databasen
//    (reserve_ai_scan) med lås, så samtidige forespørsler ikke slipper forbi.
//  * Faktisk tokenforbruk og kostnad registreres (finish_ai_scan).
//  * Bildet og teksten i det lagres ikke og logges ikke. Feil logges bare med kode.
//  * AI-svaret valideres og renses mot et fast skjema før det sendes til appen.
//  * Er AI slått av (ai_settings.enabled) eller nøkkelen mangler, svarer funksjonen
//    AI_DISABLED uten å kontakte Anthropic.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0'
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { SCHEMAS, SYSTEM_PROMPTS, USER_TEXT, sanitize, validateRequest } from '../_shared/aiScan.ts'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://bakekalkulator.rettilomma.com,http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean)

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } })

/** Feilkoder fra reserve_ai_scan som kan vises til brukeren. */
const KNOWN_ERRORS = ['AI_DISABLED', 'FORBIDDEN', 'QUOTA_EXCEEDED', 'RATE_LIMITED', 'COST_LIMIT'] as const
const STATUS: Record<string, number> = { AI_DISABLED: 503, FORBIDDEN: 403, QUOTA_EXCEEDED: 429, RATE_LIMITED: 429, COST_LIMIT: 503 }

// Grovt tak på forespørselen før JSON tolkes (base64 av maks bildestørrelse + litt)
const MAX_BODY_BYTES = 8_000_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'METHOD_NOT_ALLOWED' })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!url || !anonKey || !serviceKey) return json(req, 500, { error: 'SERVER_CONFIG' })

  // ---------- Innlogget bruker ----------
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json(req, 401, { error: 'NOT_AUTHENTICATED' })
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json(req, 401, { error: 'NOT_AUTHENTICATED' })

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // ---------- AI på? ----------
  const { data: settings } = await admin.from('ai_settings').select('enabled, monthly_cost_limit_usd, max_image_bytes').eq('id', true).maybeSingle()
  if (!apiKey || !settings?.enabled || !(Number(settings.monthly_cost_limit_usd) > 0)) return json(req, 503, { error: 'AI_DISABLED' })

  // ---------- Forespørselen ----------
  const length = Number(req.headers.get('Content-Length') ?? '0')
  if (length > MAX_BODY_BYTES) return json(req, 413, { error: 'IMAGE_TOO_LARGE' })
  let body: unknown
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return json(req, 413, { error: 'IMAGE_TOO_LARGE' })
    body = JSON.parse(raw)
  } catch {
    return json(req, 400, { error: 'INVALID_JSON' })
  }
  const input = validateRequest(body, Number(settings.max_image_bytes) || 1_500_000)
  if (!input.ok) return json(req, input.error === 'IMAGE_TOO_LARGE' ? 413 : 400, { error: input.error })

  // ---------- Reserver en skanning (kvote, hastighet, kostnadstak) ----------
  const { data: reservation, error: reserveError } = await admin.rpc('reserve_ai_scan', {
    org: input.organizationId, uid: userData.user.id, scan_kind: input.kind,
  })
  if (reserveError || !reservation) {
    const code = KNOWN_ERRORS.find((k) => reserveError?.message?.includes(k)) ?? 'RESERVE_FAILED'
    return json(req, STATUS[code] ?? 500, { error: code })
  }
  const r = reservation as { id: string; model: string; used: number; limit: number }

  // ---------- Kall Claude ----------
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })
  let inTokens = 0
  let outTokens = 0
  try {
    const response = await client.messages.create({
      model: r.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPTS[input.kind],
      // Uttrekk fra ett bilde: lav innsats holder og gir lavest kostnad
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMAS[input.kind] } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.image } },
          { type: 'text', text: USER_TEXT[input.kind] },
        ],
      }],
    })
    inTokens = response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0)
    outTokens = response.usage.output_tokens

    if (response.stop_reason === 'refusal') throw new ScanError('REFUSED')
    if (response.stop_reason === 'max_tokens') throw new ScanError('TOO_LONG')
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new ScanError('NO_RESULT')
    let parsed: unknown
    try { parsed = JSON.parse(textBlock.text) } catch { throw new ScanError('INVALID_RESULT') }

    const result = sanitize(input.kind, parsed)
    await admin.rpc('finish_ai_scan', { usage_id: r.id, ok: true, in_tokens: inTokens, out_tokens: outTokens, err: null })
    return json(req, 200, { result, quota: { used: r.used, limit: r.limit } })
  } catch (e) {
    const code = e instanceof ScanError ? e.code
      : e instanceof Anthropic.RateLimitError ? 'PROVIDER_BUSY'
      : e instanceof Anthropic.BadRequestError ? 'PROVIDER_REJECTED'
      : e instanceof Anthropic.AuthenticationError ? 'PROVIDER_AUTH'
      : e instanceof Anthropic.APIError ? 'PROVIDER_ERROR'
      : 'UNKNOWN'
    // Bare feilkoden logges – aldri bildet, teksten eller svaret
    console.error(`ai-scan feilet: ${code}`)
    await admin.rpc('finish_ai_scan', { usage_id: r.id, ok: false, in_tokens: inTokens, out_tokens: outTokens, err: code })
    return json(req, code === 'PROVIDER_BUSY' ? 503 : 502, { error: code })
  }
})

class ScanError extends Error {
  code: string
  constructor(code: string) { super(code); this.code = code }
}
