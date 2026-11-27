// Fra AI-resultat (validert på serveren) til de samme forslagsstrukturene som
// tekstgjenkjenningen gir, slik at brukeren kontrollerer alt i samme skjema.
import type { AiIngredient, AiReceipt, AiRecipe } from '../../supabase/functions/_shared/aiScan'
import type { Ingredient, Unit } from '../types'
import type { ParsedReceipt, ParsedRecipe } from './scanParse'
import { parsePackageSize } from './scanParse'

export interface AiParsedRecipe extends ParsedRecipe {
  yieldUnit: 'stk' | 'porsjoner'
  prepMinutes: number | null
}

export function recipeFromAi(r: AiRecipe): AiParsedRecipe {
  return {
    name: r.name,
    yieldCount: r.yieldCount ? Math.max(1, Math.round(r.yieldCount)) : null,
    yieldUnit: r.yieldUnit,
    ingredients: r.ingredients.map((i) => ({ line: `${i.amount || ''} ${i.unit} ${i.name}`.trim(), name: i.name, amount: i.amount > 0 ? i.amount : 1, unit: i.unit })),
    steps: r.steps,
    bakeMinutes: r.bakeMinutes ? Math.round(r.bakeMinutes) : null,
    temperatureC: r.temperatureC ? Math.round(r.temperatureC) : null,
    prepMinutes: r.prepMinutes ? Math.round(r.prepMinutes) : null,
  }
}

export interface AiParsedReceipt extends ParsedReceipt {
  date: string | null
}

/**
 * Pris per pakning: enhetspris når den finnes, ellers linjetotal delt på antall.
 * Rabatt på linjen er allerede trukket fra i totalen. Pakningsstørrelse fra
 * AI-en, ellers fra navnet («Hvetemel 2kg»).
 */
export function receiptFromAi(r: AiReceipt): AiParsedReceipt {
  return {
    store: r.supplier,
    date: r.date,
    lines: r.lines.map((l) => {
      const perPackage = l.total > 0 && l.quantity > 0 ? l.total / l.quantity : (l.unitPrice ?? 0) - l.discount / Math.max(l.quantity, 1)
      const fromName = l.packageSize ? null : parsePackageSize(l.name)
      return {
        line: `${l.name}${l.quantity !== 1 ? ` × ${l.quantity}` : ''}${l.discount ? ` (rabatt ${l.discount.toFixed(2)})` : ''}`,
        name: fromName?.rest?.trim() || l.name,
        price: Math.round(Math.max(0, perPackage) * 100) / 100,
        packageSize: l.packageSize ?? fromName?.size ?? null,
        unit: (l.packageUnit ?? fromName?.unit ?? null) as Unit | null,
      }
    }).filter((l) => l.price > 0),
  }
}

/** Ny ingrediens fra produktetikett. Allergenene er forslag og merkes som ikke kontrollert. */
export function ingredientFromAi(a: AiIngredient, base: Ingredient): Ingredient {
  return {
    ...base,
    name: a.manufacturer && !a.name.toLowerCase().includes(a.manufacturer.toLowerCase()) ? `${a.name} (${a.manufacturer})` : a.name || base.name,
    packageSize: a.packageSize ?? base.packageSize,
    unit: a.packageUnit ?? base.unit,
    allergens: a.allergens,
    allergensChecked: false,
  }
}
