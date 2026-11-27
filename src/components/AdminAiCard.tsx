import { useCallback, useEffect, useState } from 'react'
import { Save, Sparkles } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Card, Notice, NumberField, StatCard, TextField, Toggle } from './ui'
import { dbErrorMessage } from '../services/storage/mappers'
import { PLAN_NAMES } from '../lib/plans'
import type { Plan } from '../types'

interface AiSettings {
  enabled: boolean
  model: string
  input_usd_per_mtok: number
  output_usd_per_mtok: number
  monthly_cost_limit_usd: number
  estimated_cost_per_scan_usd: number
  max_scans_per_minute: number
  max_image_bytes: number
  updated_at?: string
}
interface AiAdmin {
  settings: AiSettings
  quotas: Record<Plan, number>
  month: { scans: number; failed: number; input_tokens: number; output_tokens: number; cost_usd: number; organizations: number }
}

const num = (v: unknown) => Number(v) || 0
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`

/**
 * AI-skanning for systemadministrator: av/på, modell, priser for kostnadsregistrering,
 * kostnadstak, hastighetsgrense, bildestørrelse og kvoter per plan. API-nøkkelen settes
 * som hemmelighet i Supabase (ANTHROPIC_API_KEY) og vises aldri her.
 */
export function AdminAiCard({ client }: { client: SupabaseClient }) {
  const [data, setData] = useState<AiAdmin | null>(null)
  const [draft, setDraft] = useState<AiSettings | null>(null)
  const [quotas, setQuotas] = useState<Record<Plan, number> | null>(null)
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  const fetchAi = useCallback(async () => {
    const { data: d, error } = await client.rpc('admin_get_ai_settings')
    if (error) throw new Error(dbErrorMessage(error))
    const r = d as AiAdmin
    const s = r.settings
    const settings: AiSettings = {
      enabled: !!s.enabled, model: s.model, input_usd_per_mtok: num(s.input_usd_per_mtok), output_usd_per_mtok: num(s.output_usd_per_mtok),
      monthly_cost_limit_usd: num(s.monthly_cost_limit_usd), estimated_cost_per_scan_usd: num(s.estimated_cost_per_scan_usd),
      max_scans_per_minute: num(s.max_scans_per_minute), max_image_bytes: num(s.max_image_bytes), updated_at: s.updated_at,
    }
    return { ...r, settings, month: { ...r.month, cost_usd: num(r.month.cost_usd) } }
  }, [client])

  const apply = (r: AiAdmin) => { setData(r); setDraft(r.settings); setQuotas(r.quotas) }

  useEffect(() => {
    let alive = true
    fetchAi()
      .then((r) => { if (alive) { setData(r); setDraft(r.settings); setQuotas(r.quotas) } })
      .catch((e: unknown) => { if (alive) setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Kunne ikke hente AI-innstillingene (er fase 3-migrasjonen kjørt?).' }) })
    return () => { alive = false }
  }, [fetchAi])

  if (!data || !draft || !quotas) {
    return <Card title="AI-skanning" icon={Sparkles}>{msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : <p className="muted">Henter …</p>}</Card>
  }

  const set = (p: Partial<AiSettings>) => setDraft({ ...draft, ...p })
  const save = async () => {
    setMsg(null)
    const { error } = await client.rpc('admin_set_ai_settings', { settings: draft })
    if (error) return setMsg({ tone: 'error', text: dbErrorMessage(error) })
    for (const plan of Object.keys(quotas) as Plan[]) {
      if (quotas[plan] !== data.quotas[plan]) {
        const q = await client.rpc('admin_set_ai_quota', { target_plan: plan, scans: Math.round(quotas[plan]) })
        if (q.error) return setMsg({ tone: 'error', text: dbErrorMessage(q.error) })
      }
    }
    apply(await fetchAi())
    setMsg({ tone: 'info', text: 'AI-innstillingene er lagret.' })
  }

  const m = data.month
  const used = draft.monthly_cost_limit_usd > 0 ? (m.cost_usd / draft.monthly_cost_limit_usd) * 100 : 0
  return (
    <Card title="AI-skanning" icon={Sparkles}>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="stats-grid">
        <StatCard label="Skanninger denne måneden" value={String(m.scans)} sub={`${m.failed} feilet · ${m.organizations} kunder`} icon={Sparkles} />
        <StatCard label="Kostnad denne måneden" value={usd(m.cost_usd)} sub={`${used.toFixed(0)} % av taket`} icon={Sparkles} tone={used > 80 ? 'amber' : 'default'} />
        <StatCard label="Tokens" value={`${Math.round(m.input_tokens / 1000)}k inn`} sub={`${Math.round(m.output_tokens / 1000)}k ut`} icon={Sparkles} />
      </div>
      <div className="form-grid">
        <Toggle label="AI-skanning er på" checked={draft.enabled} onChange={(v) => set({ enabled: v })}
          hint="Krever også ANTHROPIC_API_KEY som hemmelighet i Supabase og et kostnadstak over 0." />
        <TextField label="Modell" value={draft.model} onChange={(v) => set({ model: v.trim() })} placeholder="claude-haiku-5-5" />
        <NumberField label="Pris inn" value={draft.input_usd_per_mtok} max={1000} onChange={(v) => set({ input_usd_per_mtok: v })} suffix="USD/M tokens" />
        <NumberField label="Pris ut" value={draft.output_usd_per_mtok} max={1000} onChange={(v) => set({ output_usd_per_mtok: v })} suffix="USD/M tokens" />
        <NumberField label="Kostnadstak per måned" value={draft.monthly_cost_limit_usd} max={100000} onChange={(v) => set({ monthly_cost_limit_usd: v })} suffix="USD" hint="0 stopper all AI-skanning" />
        <NumberField label="Antatt maks per skanning" value={draft.estimated_cost_per_scan_usd} max={10} onChange={(v) => set({ estimated_cost_per_scan_usd: v })} suffix="USD" hint="Brukes for pågående skanninger mot taket" />
        <NumberField label="Maks per bruker per minutt" value={draft.max_scans_per_minute} integer min={1} max={100} onChange={(v) => set({ max_scans_per_minute: v })} />
        <NumberField label="Maks bildestørrelse" value={Math.round(draft.max_image_bytes / 1000)} integer min={50} max={5000} onChange={(v) => set({ max_image_bytes: v * 1000 })} suffix="kB" />
      </div>
      <h3 className="sub-head">Kvote per måned</h3>
      <div className="form-grid">
        {(Object.keys(quotas) as Plan[]).map((p) => (
          <NumberField key={p} label={PLAN_NAMES[p] ?? p} value={quotas[p]} integer max={100000} onChange={(v) => setQuotas({ ...quotas, [p]: v })} suffix="skanninger" />
        ))}
      </div>
      <p className="muted small">
        Standard er Claude Haiku 5.5 (claude-haiku-5-5) til 0,10 / 0,50 USD per million tokens. Endres modellen, må prisene oppdateres her.
        Kvotene teller vellykkede AI-skanninger per organisasjon og kalendermåned. Strekkoder og tekstgjenkjenning på telefonen teller ikke.
        Bilder og dokumentinnhold lagres eller logges ikke.
      </p>
      <div className="actions"><button className="btn primary" onClick={save}><Save size={16} /> Lagre AI-innstillinger</button></div>
    </Card>
  )
}
