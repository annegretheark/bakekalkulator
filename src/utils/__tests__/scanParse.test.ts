import { describe, expect, it } from 'vitest'
import { matchIngredient, packageUnitFor, parseAmount, parseIngredientLine, parsePackageSize, parseReceiptText, parseRecipeText, parseYield } from '../scanParse'
import { lookupProduct, parseQuantity } from '../../services/scan'
import type { Ingredient } from '../../types'

const ing = (id: string, name: string, unit: Ingredient['unit'] = 'kg'): Ingredient => ({ id, name, category: '', packageSize: 1, unit, price: 10, store: '', priceUpdated: '2026-11-27', allergens: {}, allergensChecked: true })

describe('parseAmount', () => {
  it.each([
    ['1', 1], ['1,5', 1.5], ['1.5', 1.5], ['1/2', 0.5], ['1 1/2', 1.5], ['½', 0.5], ['1½', 1.5], ['2-3', 2], ['2 – 3', 2],
  ])('%s → %d', (s, n) => expect(parseAmount(s)).toBeCloseTo(n))
  it('avviser ugyldig', () => {
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('1/0')).toBeNull()
    expect(parseAmount('0')).toBeNull()
  })
})

describe('parseIngredientLine', () => {
  it.each([
    ['500 g hvetemel', 'hvetemel', 500, 'g'],
    ['500g hvetemel', 'hvetemel', 500, 'g'],
    ['1 kg sammalt hvete, grov', 'sammalt hvete, grov', 1, 'kg'],
    ['5 dl lunkent vann', 'lunkent vann', 5, 'dl'],
    ['2 ss sukker', 'sukker', 30, 'ml'],
    ['1/2 ts salt', 'salt', 2.5, 'ml'],
    ['1 krm kardemomme', 'kardemomme', 1, 'ml'],
    ['2 egg', 'egg', 2, 'stk'],
    ['1 pk tørrgjær', 'tørrgjær', 1, 'stk'],
    ['• 50 g smør (romtemperert)', 'smør', 50, 'g'],
    ['Hvetemel 750 g', 'Hvetemel', 750, 'g'],
    ['3 cl rom', 'rom', 30, 'ml'],
  ])('%s', (line, name, amount, unit) => {
    expect(parseIngredientLine(line)).toMatchObject({ name, amount, unit })
  })
  it.each(['Bland alt godt sammen', '45 minutter', '1. Bland melet', 'Stek på 220 grader', ''])('ikke ingrediens: %s', (line) => {
    expect(parseIngredientLine(line)).toBeNull()
  })
})

describe('parseYield', () => {
  it.each([['Gir 2 brød', 2], ['ca. 12 boller', 12], ['Til 4 pizzaer', 4], ['16 stk', 16], ['Antall: 20', 20]])('%s', (s, n) => expect(parseYield(s)).toBe(n))
  it('ingen', () => expect(parseYield('Grovbrød')).toBeNull())
})

describe('parseRecipeText', () => {
  const text = `Grovbrød med havre
Gir 2 brød

Ingredienser
5 dl lunkent vann
50 g gjær
2 ts salt
300 g sammalt hvete
600 g hvetemel

Fremgangsmåte
1. Løs opp gjæren i vannet.
2. Bland inn resten og elt deigen
godt i 10 minutter.
3. Stek på 220 °C i ca. 40 minutter.`

  it('finner navn, antall, ingredienser, steg, temperatur og steketid', () => {
    const r = parseRecipeText(text)
    expect(r.name).toBe('Grovbrød med havre')
    expect(r.yieldCount).toBe(2)
    expect(r.ingredients.map((i) => i.name)).toEqual(['lunkent vann', 'gjær', 'salt', 'sammalt hvete', 'hvetemel'])
    expect(r.ingredients[2]).toMatchObject({ amount: 10, unit: 'ml' })
    expect(r.steps).toEqual(['Løs opp gjæren i vannet.', 'Bland inn resten og elt deigen godt i 10 minutter.', 'Stek på 220 °C i ca. 40 minutter.'])
    expect(r.temperatureC).toBe(220)
    expect(r.bakeMinutes).toBe(40)
  })

  it('tåler tekst uten overskrifter', () => {
    const r = parseRecipeText('Boller\n1 kg hvetemel\n2 egg\nElt deigen og la den heve.')
    expect(r.name).toBe('Boller')
    expect(r.ingredients).toHaveLength(2)
    expect(r.steps).toEqual(['Elt deigen og la den heve.'])
  })

  it('tom tekst', () => {
    expect(parseRecipeText('')).toMatchObject({ name: '', ingredients: [], steps: [], yieldCount: null })
  })
})

describe('kvittering', () => {
  it('parsePackageSize', () => {
    expect(parsePackageSize('HVETEMEL SIKTET 2KG')).toMatchObject({ size: 2, unit: 'kg', rest: 'HVETEMEL SIKTET' })
    expect(parsePackageSize('MELK 1,75L')).toMatchObject({ size: 1.75, unit: 'l' })
    expect(parsePackageSize('GJÆR 12X50G')).toMatchObject({ size: 600, unit: 'g' })
    expect(parsePackageSize('BRUS 33CL')).toMatchObject({ size: 330, unit: 'ml' })
    expect(parsePackageSize('EGG 12PK')).toMatchObject({ size: 12, unit: 'stk' })
    expect(parsePackageSize('SMØR')).toBeNull()
  })

  it('finner butikk, varer og priser og hopper over summer og betaling', () => {
    const r = parseReceiptText(`REMA 1000 STORGATA
Org.nr 123 456 789
HVETEMEL SIKTET 2KG   32,90
TINE SMØR 500G        54,90
GJÆR 50G               4,50
2 x 4,50
EGG 12PK              49,90
BANANER
0,754 kg x 24,90 kr/kg
BANANER               18,77
PANT                   3,00
SUM                  164,97
BANKKORT             164,97
MVA 15%               21,52`)
    expect(r.store).toBe('Rema 1000')
    expect(r.lines.map((l) => [l.name, l.price, l.packageSize, l.unit])).toEqual([
      ['Hvetemel siktet', 32.9, 2, 'kg'],
      ['Tine smør', 54.9, 500, 'g'],
      ['Gjær', 4.5, 50, 'g'],
      ['Egg', 49.9, 12, 'stk'],
      ['Bananer', 18.77, null, null],
    ])
  })
})

describe('matchIngredient', () => {
  const list = [ing('1', 'Hvetemel'), ing('2', 'Sammalt hvete, grov'), ing('3', 'Tørrgjær', 'g'), ing('4', 'Egg', 'stk'), ing('5', 'Smør')]
  it.each([
    ['hvetemel', '1'], ['Hvetemel siktet', '1'], ['sammalt hvete', '2'], ['tørrgjær', '3'], ['egg', '4'], ['Tine smør', '5'],
  ])('%s', (name, id) => expect(matchIngredient(name, list)?.id).toBe(id))
  it('ingen treff', () => {
    expect(matchIngredient('kardemomme', list)).toBeNull()
    expect(matchIngredient('', list)).toBeNull()
  })
  it('packageUnitFor', () => {
    expect(packageUnitFor('g')).toBe('kg')
    expect(packageUnitFor('dl')).toBe('l')
    expect(packageUnitFor('stk')).toBe('stk')
  })
})

describe('strekkode-oppslag', () => {
  it('parseQuantity', () => {
    expect(parseQuantity('1 kg')).toEqual({ size: 1, unit: 'kg' })
    expect(parseQuantity('500 g')).toEqual({ size: 500, unit: 'g' })
    expect(parseQuantity('1,75 l')).toEqual({ size: 1.75, unit: 'l' })
    expect(parseQuantity('33 cl')).toEqual({ size: 330, unit: 'ml' })
    expect(parseQuantity('12 x 50 g')).toEqual({ size: 600, unit: 'g' })
    expect(parseQuantity('')).toBeNull()
  })

  it('lookupProduct tolker svaret fra Open Food Facts og sender bare strekkoden', async () => {
    let calledUrl = ''
    const fake = (async (url: string) => {
      calledUrl = url
      return new Response(JSON.stringify({ status: 1, product: { product_name: 'Hvetemel siktet', brands: 'Møllerens,Norgesmøllene', quantity: '2 kg', categories: 'en:plant-based-foods, Mel' } }))
    }) as typeof fetch
    const p = await lookupProduct('7038010000737', fake)
    expect(calledUrl).toContain('/product/7038010000737.json')
    expect(p).toEqual({ ean: '7038010000737', name: 'Hvetemel siktet', brand: 'Møllerens', packageSize: 2, unit: 'kg', category: 'Mel' })
  })

  it('lookupProduct gir null for ukjent vare og ugyldig kode', async () => {
    const fake = (async () => new Response(JSON.stringify({ status: 0 }))) as unknown as typeof fetch
    expect(await lookupProduct('7038010000737', fake)).toBeNull()
    expect(await lookupProduct('abc', fake)).toBeNull()
  })
})
