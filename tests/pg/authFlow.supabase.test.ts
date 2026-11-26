// Ende-til-ende mot LOKAL Supabase (supabase start): registrering, e-postbekreftelse,
// innlogging, lagring og sletting av konto – med appens egne funksjoner og ekte
// Supabase Auth (GoTrue), ekte JWT og Mailpit.
//
// Kjøres kun når SUPABASE_LOCAL_URL og SUPABASE_LOCAL_KEY er satt (offentlig nøkkel):
//   SUPABASE_LOCAL_URL=http://127.0.0.1:54321 SUPABASE_LOCAL_KEY=<publishable> \
//   MAILPIT_URL=http://127.0.0.1:54324 npx vitest run --config vitest.pg.config.ts tests/pg/authFlow.supabase.test.ts
// Pek ALDRI mot produksjon.
import { describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { reauthenticate, signIn, signUp, type AuthClient } from '../../src/services/auth'
import { SupabaseRepository } from '../../src/services/storage/supabaseRepository'
import { LEGAL_VERSIONS } from '../../src/lib/legal'
import { seedData } from '../../src/lib/seed'

const URL_ = process.env.SUPABASE_LOCAL_URL
const KEY = process.env.SUPABASE_LOCAL_KEY
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
const enabled = !!URL_ && !!KEY && /127\.0\.0\.1|localhost/.test(URL_ ?? '')

const newClient = () => createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false, flowType: 'pkce' } })
const asAuth = (c: SupabaseClient) => c as unknown as AuthClient
const jwtPayload = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())

/** Henter bekreftelseslenken fra Mailpit og «klikker» den (bekrefter e-posten hos GoTrue). */
async function confirmEmail(email: string) {
  let id: string | undefined
  for (let i = 0; i < 20 && !id; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    id = ((await r.json()) as { messages?: { ID: string }[] }).messages?.[0]?.ID
    if (!id) await new Promise((res) => setTimeout(res, 500))
  }
  if (!id) throw new Error('Fant ikke bekreftelses-e-post i Mailpit')
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML?: string; Text?: string }
  const body = `${msg.HTML ?? ''} ${msg.Text ?? ''}`.replace(/&amp;/g, '&')
  const link = body.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)?.[0]
  if (!link) throw new Error('Fant ikke bekreftelseslenke i e-posten')
  const res = await fetch(link, { redirect: 'manual' })
  expect([200, 302, 303]).toContain(res.status)
}

describe.skipIf(!enabled)('registrering og sletting via appens kode mot lokal Supabase', () => {
  const stamp = Date.now().toString(36)
  const email = `e2e-${stamp}@example.com`
  const password = 'Brodbaker2026'
  const client = newClient()

  it('registrering krever e-postbekreftelse og lagrer navn, kontotype og vilkår', async () => {
    const r = await signUp(asAuth(client), {
      fullName: 'E2E Baker', email, password, passwordConfirm: password, accountType: 'business',
      organizationName: 'E2E Bakeri AS', acceptTerms: true, acceptPrivacy: true,
    }, 'http://localhost:5174')
    expect(r.needsConfirmation).toBe(true)
    await expect(signIn(asAuth(newClient()), email, password)).rejects.toThrow(/ikke bekreftet/)
  })

  it('e-postbekreftelse via lenken i e-posten', async () => {
    await confirmEmail(email)
  })

  it('innlogging gir JWT med amr (passord + tidspunkt) og riktig kontekst', async () => {
    await signIn(asAuth(client), email, password)
    const { data } = await client.auth.getSession()
    const p = jwtPayload(data.session!.access_token)
    expect(p.role).toBe('authenticated')
    // Formatet serveren (recently_authenticated) forventer:
    expect(Array.isArray(p.amr)).toBe(true)
    const pw = p.amr.find((a: { method: string }) => a.method === 'password')
    expect(pw).toBeTruthy()
    expect(typeof pw.timestamp).toBe('number')
    expect(Math.abs(pw.timestamp - Date.now() / 1000)).toBeLessThan(120)

    const { data: ctx, error } = await client.rpc('get_my_context')
    expect(error).toBeNull()
    expect(ctx.profile.full_name).toBe('E2E Baker')
    expect(ctx.organizations[0]).toMatchObject({ name: 'E2E Bakeri AS', type: 'business', role: 'owner' })
    expect(ctx.organizations[0].subscription.effective_plan).toBe('pro')
    expect(ctx.legal.accepted.map((a: { document: string; version: string }) => `${a.document}:${a.version}`).sort())
      .toEqual([`privacy:${LEGAL_VERSIONS.privacy}`, `terms:${LEGAL_VERSIONS.terms}`])
  })

  it('appens lagringslag (SupabaseRepository) lagrer og leser data', async () => {
    const { data: ctx } = await client.rpc('get_my_context')
    const { data: u } = await client.auth.getUser()
    const repo = new SupabaseRepository(client, ctx.organizations[0].id, u.user!.id, 'pro')
    const d = seedData()
    const ing = { ...d.ingredients[0], id: crypto.randomUUID() }
    await repo.upsertIngredient(ing)
    await repo.upsertIngredient({ ...ing, price: 40 }) // redigering
    await repo.upsertRecipe({ ...d.recipes[0], id: crypto.randomUUID(), ingredients: [{ id: crypto.randomUUID(), ingredientId: ing.id, amount: 750, unit: 'g' }] })
    const loaded = await repo.load()
    expect(loaded.ingredients.find((i) => i.id === ing.id)?.price).toBe(40)
    expect(loaded.recipes).toHaveLength(1)
    expect(loaded.recipes[0].ingredients[0].ingredientId).toBe(ing.id)
  })

  it('sletting av konto: feil passord stopper, riktig passord + SLETT sletter', async () => {
    await expect(reauthenticate(asAuth(client), email, 'feil-passord1')).rejects.toThrow('Feil e-post eller passord.')
    const { error: noConfirm } = await client.rpc('delete_my_account', { confirmation: 'slett' })
    expect(noConfirm?.message).toMatch(/CONFIRMATION_REQUIRED/)

    await reauthenticate(asAuth(client), email, password) // som appen gjør rett før sletting
    const { data, error } = await client.rpc('delete_my_account', { confirmation: 'SLETT' })
    expect(error).toBeNull()
    expect(data).toEqual({ deleted_organizations: 1, transferred_ownership: 0 })
  })

  it('etter sletting: gammelt token gir ingen data, og innlogging er ikke mulig', async () => {
    const { data: recipes } = await client.from('recipes').select('id')
    expect(recipes ?? []).toEqual([])
    await expect(signIn(asAuth(newClient()), email, password)).rejects.toThrow()
  })
})
