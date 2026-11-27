import type { AppData, BakeLog, Ingredient, Recipe } from '../types'
import { defaultEnergyInput, defaultSettings } from './defaults'

export const DATA_VERSION = 1

const today = new Date().toISOString().slice(0, 10)

const ing = (id: string, name: string, category: string, packageSize: number, unit: Ingredient['unit'], price: number, store: string): Ingredient => ({
  id, name, category, packageSize, unit, price, store, priceUpdated: today,
})

/** Eksempelpriser for demonstrasjon – oppdater med egne priser. */
export const SEED_INGREDIENTS: Ingredient[] = [
  ing('ing-hvetemel', 'Hvetemel', 'Mel', 2, 'kg', 32, 'Dagligvare'),
  ing('ing-sammalt', 'Sammalt hvete, grov', 'Mel', 1, 'kg', 28, 'Dagligvare'),
  ing('ing-rug', 'Sammalt rug', 'Mel', 1, 'kg', 34, 'Dagligvare'),
  ing('ing-havregryn', 'Havregryn', 'Korn og frø', 1.1, 'kg', 25, 'Dagligvare'),
  ing('ing-solsikke', 'Solsikkekjerner', 'Korn og frø', 400, 'g', 30, 'Dagligvare'),
  ing('ing-gjar', 'Tørrgjær', 'Gjær', 132, 'g', 30, 'Dagligvare'),
  ing('ing-salt', 'Salt', 'Krydder', 1, 'kg', 15, 'Dagligvare'),
  ing('ing-olje', 'Rapsolje', 'Fett', 1, 'l', 45, 'Dagligvare'),
  ing('ing-honning', 'Honning', 'Søtning', 350, 'g', 49, 'Dagligvare'),
  ing('ing-vann', 'Vann', 'Annet', 1, 'l', 0, 'Springen'),
]

const now = new Date().toISOString()

export const SEED_RECIPES: Recipe[] = [
  {
    id: 'rec-grovbrod',
    name: 'Tre grove brød',
    type: 'brod',
    category: 'brod_bakervarer',
    yieldCount: 3,
    yieldUnit: 'stk',
    prepMinutes: 20,
    finishedWeightG: 3300,
    ingredients: [
      { id: 'ri-1', ingredientId: 'ing-vann', amount: 1.5, unit: 'l' },
      { id: 'ri-2', ingredientId: 'ing-gjar', amount: 24, unit: 'g' },
      { id: 'ri-3', ingredientId: 'ing-salt', amount: 30, unit: 'g' },
      { id: 'ri-4', ingredientId: 'ing-olje', amount: 0.5, unit: 'dl' },
      { id: 'ri-5', ingredientId: 'ing-honning', amount: 30, unit: 'g' },
      { id: 'ri-6', ingredientId: 'ing-sammalt', amount: 750, unit: 'g' },
      { id: 'ri-7', ingredientId: 'ing-rug', amount: 250, unit: 'g' },
      { id: 'ri-8', ingredientId: 'ing-havregryn', amount: 200, unit: 'g' },
      { id: 'ri-9', ingredientId: 'ing-solsikke', amount: 100, unit: 'g' },
      { id: 'ri-10', ingredientId: 'ing-hvetemel', amount: 1250, unit: 'g' },
    ],
    steps: [
      'Bland lunkent vann (ca. 37 °C), gjær, honning og olje.',
      'Tilsett salt, sammalt hvete, rug, havregryn og solsikkekjerner.',
      'Tilsett hvetemel litt etter litt og elt deigen i kjøkkenmaskin i ca. 10 minutter.',
      'La deigen heve under plast til dobbel størrelse, ca. 60 minutter.',
      'Del deigen i tre, form brødene og legg dem i smurte former.',
      'Etterhev i ca. 30 minutter mens ovnen forvarmes til 230 °C.',
      'Stek nederst i ovnen i ca. 45 minutter til brødene høres hule ut når du banker under.',
      'Avkjøl på rist uten form.',
    ],
    riseMinutes: 90,
    bakeMinutes: 45,
    storePricePerItem: 45,
    notes: 'Alle tre brød stekes samtidig i én omgang.',
    energy: defaultEnergyInput(),
    createdAt: now,
    updatedAt: now,
  },
]

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(17, 0, 0, 0)
  return d.toISOString()
}

const log = (id: string, days: number, kwh: number, price: number, ingredientCost: number): BakeLog => {
  const electricityCost = kwh * price
  const totalCost = electricityCost + ingredientCost
  return {
    id, date: daysAgo(days), recipeId: 'rec-grovbrod', recipeName: 'Tre grove brød', type: 'brod', count: 3,
    kwh, pricePerKwh: price, electricityCost, ingredientCost, totalCost, costPerItem: totalCost / 3,
    storePricePerItem: 45, revenue: null, profit: null, note: 'Eksempeldata',
  }
}

export const SEED_HISTORY: BakeLog[] = [log('log-1', 2, 1.9, 1.35, 56.2), log('log-2', 9, 1.85, 1.6, 55.1), log('log-3', 21, 2.0, 1.1, 54.8)]

export function seedData(): AppData {
  return {
    version: DATA_VERSION,
    settings: defaultSettings(),
    ingredients: SEED_INGREDIENTS,
    recipes: SEED_RECIPES,
    history: SEED_HISTORY,
    equipment: [],
  }
}

export function emptyData(): AppData {
  return { version: DATA_VERSION, settings: defaultSettings(), ingredients: [], recipes: [], history: [], equipment: [] }
}
