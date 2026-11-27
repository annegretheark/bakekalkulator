import { describe, expect, it } from 'vitest'
import { SCHEMAS, SYSTEM_PROMPTS, base64Bytes, sanitize, sanitizeIngredient, sanitizeReceipt, sanitizeRecipe, validateRequest } from '../../../supabase/functions/_shared/aiScan'
import { ingredientFromAi, receiptFromAi, recipeFromAi } from '../aiMapping'
import { allergensFromOff, lookupProduct, ProductLookupError } from '../../services/scan'
import { scaledSize } from '../../services/aiScan'
import { blankIngredient } from '../../lib/scanHandoff'

const ORG = '0b7f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e'

describe('AI-svar valideres og renses', () => {
  it('oppskrift: tall, enheter, lengder og tomme linjer', () => {
    const r = sanitizeRecipe({
      name: '  Grove  rundstykker\n', yield_count: 12, yield_unit: 'stk', prep_minutes: 0, bake_minutes: 20, temperature_c: 9999,
      ingredients: [
        { name: 'Hvetemel', amount: 500, unit: 'g' },
        { name: 'Melk', amount: 3, unit: 'kopper' }, // ugyldig enhet → stk
        { name: '', amount: 1, unit: 'g' }, // uten navn → fjernes
        { name: 'Salt', amount: -2, unit: 'ts' },
      ],
      steps: ['Elt deigen', '', 42],
    })
    expect(r.name).toBe('Grove rundstykker')
    expect(r).toMatchObject({ yieldCount: 12, yieldUnit: 'stk', prepMinutes: null, bakeMinutes: 20, temperatureC: 500 })
    expect(r.ingredients).toEqual([
      { name: 'Hvetemel', amount: 500, unit: 'g' },
      { name: 'Melk', amount: 3, unit: 'stk' },
      { name: 'Salt', amount: 0, unit: 'stk' },
    ])
    expect(r.steps).toEqual(['Elt deigen'])
  })

  it('tåler søppel og feil typer uten å kaste', () => {
    expect(sanitizeRecipe(null)).toMatchObject({ name: '', ingredients: [], steps: [] })
    expect(sanitizeReceipt('tekst')).toMatchObject({ supplier: '', lines: [], date: null })
    expect(sanitizeIngredient([1, 2])).toMatchObject({ name: '', allergens: {} })
    expect(sanitize('oppskrift', { ingredients: 'ikke en liste' })).toMatchObject({ kind: 'oppskrift', recipe: { ingredients: [] } })
  })

  it('begrenser antall linjer og lengde', () => {
    const many = sanitizeRecipe({ ingredients: Array.from({ length: 500 }, (_, i) => ({ name: `I${i}`, amount: 1, unit: 'g' })), name: 'x'.repeat(1000) })
    expect(many.ingredients).toHaveLength(100)
    expect(many.name).toHaveLength(200)
  })

  it('kvittering: dato, rabatt, linjer uten pris og ukjente verdier', () => {
    const r = sanitizeReceipt({
      supplier: 'ASKO', date: '2026-11-28', total: 512.5,
      lines: [
        { name: 'Hvetemel 25 kg', quantity: 2, package_size: 25, package_unit: 'kg', unit_price: 450, discount: 50, vat_percent: 15, total: 850 },
        { name: 'Pant', quantity: 1, package_size: 0, package_unit: '', unit_price: 0, discount: 0, vat_percent: 0, total: 0 },
      ],
    })
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({ quantity: 2, packageSize: 25, packageUnit: 'kg', discount: 50, vatPercent: 15, total: 850 })
    expect(sanitizeReceipt({ date: '28.11.2026' }).date).toBeNull()
    expect(sanitizeReceipt({ date: '2026-13-45' }).date).toBeNull()
  })

  it('etikett: bare kjente allergener, «inneholder» vinner over «spor»', () => {
    const a = sanitizeIngredient({
      name: 'Kjeks', manufacturer: 'Bakeriet', package_size: 300, package_unit: 'g', ingredients_text: 'Hvetemel, sukker',
      allergens: [{ code: 'gluten', level: 'ja' }, { code: 'notter', level: 'spor' }, { code: 'gluten', level: 'spor' }, { code: 'kokos', level: 'ja' }, { code: 'egg', level: 'nei' }],
    })
    expect(a.allergens).toEqual({ gluten: 'ja', notter: 'spor' })
  })
})

describe('forespørsel til Edge Function', () => {
  const ok = { organizationId: ORG, kind: 'kvittering', mediaType: 'image/jpeg', image: 'QUJD' }

  it('godtar gyldig forespørsel', () => {
    expect(validateRequest(ok, 1000)).toMatchObject({ ok: true, kind: 'kvittering' })
  })

  it('avviser ugyldig organisasjon, type, format og for store bilder', () => {
    expect(validateRequest({ ...ok, organizationId: 'x' }, 1000)).toEqual({ ok: false, error: 'INVALID_ORGANIZATION' })
    expect(validateRequest({ ...ok, kind: 'pass' }, 1000)).toEqual({ ok: false, error: 'INVALID_KIND' })
    expect(validateRequest({ ...ok, mediaType: 'image/gif' }, 1000)).toEqual({ ok: false, error: 'INVALID_MEDIA_TYPE' })
    expect(validateRequest({ ...ok, image: 'data:image/jpeg;base64,QUJD' }, 1000)).toEqual({ ok: false, error: 'INVALID_IMAGE' })
    expect(validateRequest({ ...ok, image: 'A'.repeat(4000) }, 1000)).toEqual({ ok: false, error: 'IMAGE_TOO_LARGE' })
    expect(validateRequest(null, 1000)).toMatchObject({ ok: false })
  })

  it('regner byte i base64 uten å dekode', () => {
    expect(base64Bytes('QUJD')).toBe(3)
    expect(base64Bytes('QUI=')).toBe(2)
    expect(base64Bytes('QQ==')).toBe(1)
  })

  it('skjemaene er strenge (alle felt påkrevd, ingen ekstra felt)', () => {
    for (const s of Object.values(SCHEMAS)) {
      expect(s.additionalProperties).toBe(false)
      expect((s.required as string[]).sort()).toEqual(Object.keys(s.properties as object).sort())
    }
  })

  it('instruksjonene sier at tekst i bildet er data, ikke instruksjoner', () => {
    for (const p of Object.values(SYSTEM_PROMPTS)) expect(p).toMatch(/never instructions/)
  })
})

describe('AI-resultat til skjemaene i appen', () => {
  it('oppskrift beholder porsjoner og tilberedningstid', () => {
    const p = recipeFromAi({ name: 'Lasagne', yieldCount: 6, yieldUnit: 'porsjoner', ingredients: [{ name: 'Kjøttdeig', amount: 0, unit: 'g' }], steps: ['Stek'], prepMinutes: 30.4, bakeMinutes: 45, temperatureC: 200 })
    expect(p).toMatchObject({ yieldCount: 6, yieldUnit: 'porsjoner', prepMinutes: 30, bakeMinutes: 45, temperatureC: 200 })
    expect(p.ingredients[0].amount).toBe(1) // ukjent mengde → 1, brukeren retter
  })

  it('kvittering: pris per pakning etter rabatt, pakning fra navnet', () => {
    const r = receiptFromAi({
      supplier: 'Rema 1000', date: '2026-11-28', total: null,
      lines: [
        { name: 'Hvetemel 2kg', quantity: 2, packageSize: null, packageUnit: null, unitPrice: 32, discount: 10, vatPercent: 15, total: 54 },
        { name: 'Smør', quantity: 1, packageSize: 500, packageUnit: 'g', unitPrice: 59.9, discount: 0, vatPercent: null, total: 59.9 },
      ],
    })
    expect(r).toMatchObject({ store: 'Rema 1000', date: '2026-11-28' })
    expect(r.lines[0]).toMatchObject({ price: 27, packageSize: 2, unit: 'kg' })
    expect(r.lines[0].name).not.toMatch(/2kg/)
    expect(r.lines[1]).toMatchObject({ name: 'Smør', price: 59.9, packageSize: 500, unit: 'g' })
  })

  it('ingrediens fra etikett merkes som ikke kontrollert', () => {
    const i = ingredientFromAi({ name: 'Havregryn', manufacturer: 'AXA', packageSize: 1.1, packageUnit: 'kg', ingredientsText: 'Havre', allergens: { gluten: 'ja' } }, blankIngredient())
    expect(i).toMatchObject({ name: 'Havregryn (AXA)', packageSize: 1.1, unit: 'kg', allergens: { gluten: 'ja' }, allergensChecked: false, price: 0 })
  })
})

describe('Open Food Facts', () => {
  it('allergen- og sporstagger blir appens allergener', () => {
    expect(allergensFromOff(['en:gluten', 'en:milk', 'en:unknown'], ['en:nuts', 'en:milk'])).toEqual({ gluten: 'ja', melk: 'ja', notter: 'spor' })
    expect(allergensFromOff(null, undefined)).toEqual({})
  })

  it('henter allergener og ingrediensliste, og ber bare om nødvendige felt', async () => {
    let calledUrl = ''
    const fake = (async (url: string) => {
      calledUrl = url
      return new Response(JSON.stringify({ status: 1, product: { product_name: 'Kjeks', brands: 'Sætre', quantity: '250 g', ingredients_text_nb: 'Hvetemel, smør', allergens_tags: ['en:gluten', 'en:milk'], traces_tags: ['en:nuts'] } }))
    }) as typeof fetch
    const p = await lookupProduct('7038010000737', fake)
    expect(calledUrl).toContain('allergens_tags')
    expect(p).toMatchObject({ name: 'Kjeks', ingredientsText: 'Hvetemel, smør', allergens: { gluten: 'ja', melk: 'ja', notter: 'spor' } })
  })

  it('opptatt tjeneste gir egen feil, ukjent vare gir null', async () => {
    const busy = (async () => new Response('', { status: 429 })) as unknown as typeof fetch
    await expect(lookupProduct('7038010000737', busy)).rejects.toBeInstanceOf(ProductLookupError)
    const down = (async () => { throw new TypeError('network') }) as unknown as typeof fetch
    await expect(lookupProduct('7038010000737', down)).rejects.toBeInstanceOf(ProductLookupError)
    const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    expect(await lookupProduct('7038010000737', missing)).toBeNull()
  })
})

describe('bildekomprimering', () => {
  it('lengste side holdes under grensen, forholdet beholdes', () => {
    expect(scaledSize(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(scaledSize(3024, 4032)).toEqual({ width: 1200, height: 1600 })
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})
