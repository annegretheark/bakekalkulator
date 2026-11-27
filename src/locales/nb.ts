// Norsk bokmål. Nye språk legges til som egne filer med samme nøkler (se index.ts).
export const nb = {
  'app.name': 'Rett i lomma',
  'app.subtitle': 'Matkalkulator',

  'nav.overview': 'Oversikt',
  'nav.calculator': 'Bakekalkulator',
  'nav.prices': 'Strømpriser',
  'nav.recipes': 'Mine oppskrifter',
  'nav.ingredients': 'Ingredienser',
  'nav.equipment': 'Utstyr',
  'nav.costs': 'Personal og drift',
  'nav.menus': 'Menyer',
  'nav.scan': 'Skann',
  'nav.dashboard': 'Dashboard',
  'nav.suppliers': 'Leverandører',
  'nav.stock': 'Lager',
  'nav.waste': 'Matsvinn',
  'nav.history': 'Bakehistorikk',
  'nav.sales': 'Salg og fortjeneste',
  'nav.settings': 'Innstillinger',

  'bakeType.brod': 'Brød',
  'bakeType.rundstykker': 'Rundstykker',
  'bakeType.kake': 'Kake',
  'bakeType.pizza': 'Pizza',
  'bakeType.boller': 'Boller',
  'bakeType.annet': 'Annet',

  'priceMode.spot': 'Spotpris',
  'priceMode.norgespris': 'Norgespris',
  'priceMode.fastpris': 'Fastpris',
  'priceMode.manuell': 'Manuell pris',

  'customerType.privat': 'Privat',
  'customerType.bedrift': 'Bedrift',

  'common.save': 'Lagre',
  'common.cancel': 'Avbryt',
  'common.delete': 'Slett',
  'common.edit': 'Rediger',
  'common.copy': 'Kopier',
  'common.add': 'Legg til',
  'common.close': 'Lukk',
  'common.perItem': 'per stk',
} as const

export type TranslationKey = keyof typeof nb
export type Dictionary = Record<TranslationKey, string>
