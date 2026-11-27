// Tolking av tekst fra skannede bilder (OCR). Rene funksjoner uten nettleser-API,
// slik at de kan testes. Resultatet er alltid et forslag som brukeren kontrollerer.
import type { Ingredient, Unit } from '../types'

export interface ParsedIngredient {
  /** Originallinjen fra bildet, for kontroll. */
  line: string
  name: string
  amount: number
  unit: Unit
}

export interface ParsedRecipe {
  name: string
  yieldCount: number | null
  ingredients: ParsedIngredient[]
  steps: string[]
  bakeMinutes: number | null
  temperatureC: number | null
}

export interface ParsedReceiptLine {
  line: string
  name: string
  price: number
  packageSize: number | null
  unit: Unit | null
}

export interface ParsedReceipt {
  store: string
  lines: ParsedReceiptLine[]
}

// ---------- Tall og enheter ----------

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 }

/** Tolker «1», «1,5», «1.5», «1/2», «1 1/2», «½», «1½» og «2-3» (første tall). */
export function parseAmount(raw: string): number | null {
  let s = raw.trim()
  for (const [ch, v] of Object.entries(FRACTIONS)) s = s.replace(ch, ` ${v}`)
  s = s.replace(/\s*[-–]\s*\d+(?:[.,]\d+)?$/, '') // intervall: bruk første tall
  const parts = s.trim().split(/\s+/)
  let total = 0
  for (const p of parts) {
    const frac = p.match(/^(\d+)\/(\d+)$/)
    if (frac) {
      if (Number(frac[2]) === 0) return null
      total += Number(frac[1]) / Number(frac[2])
    } else if (/^\d+(?:[.,]\d+)?$/.test(p)) total += Number(p.replace(',', '.'))
    else return null
  }
  return Number.isFinite(total) && total > 0 ? total : null
}

/** Enhetsord → appens enhet og faktor. Skjeer regnes om til ml, pakker og egg til stk. */
const UNIT_ALIASES: [RegExp, Unit, number][] = [
  [/^(g|gr|gram)\.?$/i, 'g', 1],
  [/^(kg|kilo)\.?$/i, 'kg', 1],
  [/^(ml)\.?$/i, 'ml', 1],
  [/^(cl)\.?$/i, 'ml', 10],
  [/^(dl)\.?$/i, 'dl', 1],
  [/^(l|liter|ltr)\.?$/i, 'l', 1],
  [/^(ss|spiseskje|spiseskjeer)\.?$/i, 'ml', 15],
  [/^(ts|teskje|teskjeer)\.?$/i, 'ml', 5],
  [/^(krm|klype)\.?$/i, 'ml', 1],
  [/^(stk|st|stykk|stykker)\.?$/i, 'stk', 1],
  [/^(pk|pakke|pakker|pose|poser|boks|bokser|beger|fedd|terning|terninger)\.?$/i, 'stk', 1],
]

export function parseUnit(word: string): { unit: Unit; factor: number } | null {
  for (const [re, unit, factor] of UNIT_ALIASES) if (re.test(word)) return { unit, factor }
  return null
}

const AMOUNT = String.raw`(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|\d*[½¼¾⅓⅔⅛])(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?`

/** Rydder en ingrediens: fjerner punktum, parenteser og tegn som OCR ofte legger til. */
function cleanName(s: string): string {
  return s.replace(/\(.*?\)/g, '').replace(/^[\s,.:;•·*-]+|[\s,.:;•·*-]+$/g, '').replace(/\s{2,}/g, ' ').trim()
}

/**
 * Tolker en ingredienslinje, f.eks. «500 g hvetemel», «2 ss sukker», «1/2 ts salt»,
 * «2 egg» eller «Hvetemel 500 g». Returnerer null hvis linjen ikke ser ut som en ingrediens.
 */
export function parseIngredientLine(raw: string): ParsedIngredient | null {
  const r = parseIngredientLineRaw(raw)
  return r && !NOT_INGREDIENT.test(r.name) ? r : null
}

/** Tider, temperaturer og lignende som ellers kunne se ut som mengde + navn. */
const NOT_INGREDIENT = /^(min|minutter|minutt|timer?|sek|sekunder|grader|°|ganger|dager?|døgn|cm|mm)(?![a-zæøå])/i

function parseIngredientLineRaw(raw: string): ParsedIngredient | null {
  const line = raw.replace(/^[\s•·*-]+/, '').trim()
  if (!line || line.length > 80 || /^\d+\s*[.)]\s/.test(line)) return null
  // Mengde først
  let m = line.match(new RegExp(`^${AMOUNT}\\s*([a-zæøå.]+)?\\s+(.+)$`, 'i'))
  if (m) {
    const amount = parseAmount(m[1])
    if (amount === null) return null
    const u = m[2] ? parseUnit(m[2]) : null
    const name = cleanName(u ? m[3] : `${m[2] ?? ''} ${m[3]}`)
    if (!name || !/[a-zæøå]/i.test(name)) return null
    return u
      ? { line, name, amount: round(amount * u.factor), unit: u.unit }
      : { line, name, amount: round(amount), unit: 'stk' }
  }
  // Navn først, mengde sist
  m = line.match(new RegExp(`^(.+?)[\\s,:]+${AMOUNT}\\s*([a-zæøå.]+)?$`, 'i'))
  if (m) {
    const amount = parseAmount(m[2])
    const u = m[3] ? parseUnit(m[3]) : null
    const name = cleanName(m[1])
    if (amount === null || !name || (m[3] && !u) || !/[a-zæøå]/i.test(name)) return null
    return u ? { line, name, amount: round(amount * u.factor), unit: u.unit } : { line, name, amount: round(amount), unit: 'stk' }
  }
  return null
}

const round = (n: number) => Math.round(n * 1000) / 1000

// ---------- Oppskrift ----------

const INGREDIENT_HEADER = /^(ingredienser|du trenger|deig|fyll|glasur|topping)\s*:?$/i
const STEP_HEADER = /^(fremgangsmåte|framgangsmåte|slik gjør du|instruksjoner|gjør slik)\s*:?$/i

/** Tolker en hel oppskrift fra OCR-tekst. */
export function parseRecipeText(text: string): ParsedRecipe {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const ingredients: ParsedIngredient[] = []
  const rest: string[] = []
  let name = ''
  let inSteps = false
  for (const l of lines) {
    if (STEP_HEADER.test(l)) { inSteps = true; continue }
    if (INGREDIENT_HEADER.test(l)) { inSteps = false; continue }
    const ing = !inSteps && !/^\d+\s*[.)]\s+\D/.test(l) ? parseIngredientLine(l) : null
    if (ing) { ingredients.push(ing); continue }
    if (!name && !ingredients.length && !parseYield(l) && l.length <= 60 && /[a-zæøå]/i.test(l)) { name = cleanName(l); continue }
    rest.push(l)
  }

  // Steg: nummererte linjer starter nytt steg; andre linjer limes til forrige (linjebrudd fra bildet)
  const steps: string[] = []
  for (const l of rest) {
    if (parseYield(l) && l.length < 40) continue
    const numbered = l.match(/^(\d+)\s*[.)]\s+(.*)$/)
    if (numbered) steps.push(numbered[2])
    else if (steps.length && !/[.!?:]$/.test(steps[steps.length - 1])) steps[steps.length - 1] += ` ${l}`
    else steps.push(l)
  }

  const all = lines.join(' ')
  const temp = all.match(/(\d{3})\s*(?:°|grader|º)\s*C?/i)
  const bake = all.match(/stek\w*.{0,60}?(\d{1,3})\s*(?:[-–]\s*\d{1,3}\s*)?min/i)
  return {
    name,
    yieldCount: lines.map(parseYield).find((n) => n !== null) ?? null,
    ingredients,
    steps: steps.map((s) => s.replace(/\s{2,}/g, ' ').trim()).filter(Boolean),
    bakeMinutes: bake ? Number(bake[1]) : null,
    temperatureC: temp ? Number(temp[1]) : null,
  }
}

/** «Gir 2 brød», «ca. 12 boller», «Til 4 pizzaer», «16 stk» → antall. */
export function parseYield(line: string): number | null {
  const what = String.raw`(stk|brød|boller|rundstykker|porsjoner|pizza\w*|kaker?|biter|stykker|små|horn|skiver)`
  // «gir»/«antall» trenger ikke enhet; «til»/«ca.» gjør det (ellers blir «ca. 40 minutter» et antall)
  const m = line.match(new RegExp(String.raw`(?:gir|antall:?)\s*(?:ca\.?\s*)?(\d{1,4})\s*(?:[-–]\s*\d+\s*)?${what}?(?![a-zæøå])`, 'i'))
    ?? line.match(new RegExp(String.raw`(?:til|ca\.?)\s*(\d{1,4})\s*(?:[-–]\s*\d+\s*)?${what}`, 'i'))
    ?? line.match(/^(\d{1,4})\s*(stk|brød|boller|rundstykker|porsjoner|pizzaer)\b/i)
  if (!m) return null
  const n = Number(m[1])
  return n > 0 && n <= 10000 ? n : null
}

// ---------- Kvittering ----------

const STORES = ['REMA 1000', 'KIWI', 'MENY', 'COOP EXTRA', 'COOP PRIX', 'COOP MEGA', 'COOP OBS', 'COOP MARKED', 'EXTRA', 'OBS', 'SPAR', 'JOKER', 'BUNNPRIS', 'ODA', 'EUROSPAR', 'NÆRBUTIKKEN', 'ASKO', 'MATKROKEN', 'BAKEHUSET', 'EUROPRIS', 'HELLO SAFARI']
const SKIP = /\b(sum|total|totalt|å betale|betalt|mva|moms|bank|bankkort|kortbetaling|betalingskort|kort|visa|mastercard|vipps|kontant|veksel|tilbake|rabatt|bonus|trumf|pant|ref|org\.?\s*nr|foretak|tlf|kvittering|kasse|dato|tid|kunde|medlem|spart|avrunding|antall varer|terminal|bax|aid|kopi)\b/i

/** Pakningsstørrelse i varenavnet, f.eks. «HVETEMEL 2KG», «MELK 1,75L», «GJÆR 12X50G». */
export function parsePackageSize(name: string): { size: number; unit: Unit; rest: string } | null {
  const m = name.match(/(?:(\d+)\s*[xX]\s*)?(\d+(?:[.,]\d+)?)\s*(KG|G|GR|L|LTR|DL|CL|ML|STK|PK)\b/i)
  if (!m) return null
  const multi = m[1] ? Number(m[1]) : 1
  let size = Number(m[2].replace(',', '.')) * multi
  let unit = m[3].toLowerCase()
  if (unit === 'gr') unit = 'g'
  if (unit === 'ltr') unit = 'l'
  if (unit === 'pk') unit = 'stk'
  if (unit === 'cl') { size *= 10; unit = 'ml' }
  if (!(size > 0)) return null
  return { size: round(size), unit: unit as Unit, rest: name.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim() }
}

/** «HVETEMEL SIKTET» → «Hvetemel siktet». */
function tidyName(s: string): string {
  const t = s.replace(/[*#]+/g, '').replace(/\s{2,}/g, ' ').trim().toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Tolker varelinjer med pris fra en butikkvittering. */
export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const head = lines.slice(0, 8).join(' ').toUpperCase()
  const store = STORES.find((s) => head.includes(s)) ?? ''
  const out: ParsedReceiptLine[] = []
  for (const line of lines) {
    if (SKIP.test(line)) continue
    // Mengde- og vektlinjer («2 x 19,90», «0,754 kg x 39,90 kr/kg») er ikke egne varer
    if (/^\d+(?:[.,]\d+)?\s*(?:kg\s*)?[xX*]\s*\d/.test(line) || /kr\s*\/\s*kg/i.test(line)) continue
    const m = line.match(/^(.*?[a-zæøå].*?)\s+(-?\d{1,5}[.,]\d{2})\s*[A-Z%]{0,2}$/i)
    if (!m) continue
    const price = Number(m[2].replace(',', '.'))
    if (!(price > 0)) continue
    const raw = m[1].replace(/\s+\d+[.,]\d{2}$/, '') // enhetspris foran totalpris
    const pkg = parsePackageSize(raw)
    const name = tidyName(cleanName(pkg ? pkg.rest : raw))
    if (name.length < 2) continue
    out.push({ line, name, price, packageSize: pkg?.size ?? null, unit: pkg?.unit ?? null })
  }
  return { store: store ? store.charAt(0) + store.slice(1).toLowerCase() : '', lines: out }
}

// ---------- Kobling mot ingrediensregisteret ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-zæøå0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const stem = (w: string) => w.replace(/(ene|er|en|et|e)$/, '')

/** Finner den ingrediensen i registeret som passer best med navnet, eller null. */
export function matchIngredient(name: string, ingredients: Ingredient[]): Ingredient | null {
  const n = norm(name)
  if (!n) return null
  const words = new Set(n.split(' ').map(stem).filter((w) => w.length > 1))
  let best: { ing: Ingredient; score: number } | null = null
  for (const ing of ingredients) {
    const m = norm(ing.name)
    if (!m) continue
    let score: number
    if (m === n) score = 1
    else if (n.includes(m) || m.includes(n)) score = 0.85
    else {
      const other = new Set(m.split(' ').map(stem).filter((w) => w.length > 1))
      const common = [...words].filter((w) => other.has(w) || [...other].some((o) => o.length > 3 && w.length > 3 && (o.startsWith(w) || w.startsWith(o)))).length
      score = common / Math.max(words.size, other.size, 1)
    }
    if (!best || score > best.score) best = { ing, score }
  }
  return best && best.score >= 0.5 ? best.ing : null
}

/** Standard pakningsenhet for en ny ingrediens ut fra enheten i oppskriften. */
export function packageUnitFor(unit: Unit): Unit {
  if (unit === 'g') return 'kg'
  if (unit === 'ml' || unit === 'dl') return 'l'
  return unit
}
