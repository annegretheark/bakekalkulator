import type { AppSettings, EnergyInput, PriceArea, PriceSettings, CostSettings, StaffRole, Ingredient } from '../types'

export const AREA_NAMES: Record<PriceArea, string> = {
  NO1: 'Østlandet',
  NO2: 'Sørlandet',
  NO3: 'Midt-Norge',
  NO4: 'Nord-Norge',
  NO5: 'Vestlandet',
}

/**
 * Offentlige satser kontrollert november 2026. De er STANDARDVERDIER som brukeren
 * kan endre i Innstillinger – de er ikke hardkodet inn i beregningene.
 * Kontroller alltid mot kildene før bruk.
 */
export const RATE_REFERENCES = {
  checked: '2026-11-26',
  norgespris: {
    krPerKwhExVat: 0.4,
    validTo: '2026-12-31',
    source: 'https://lovdata.no/dokument/SF/forskrift/2025-09-08-1790',
    note: '40 øre/kWh eks. mva t.o.m. 31.12.2026 (forskrift om Norgespris § 10). Sats for 2027 er ikke fastsatt.',
  },
  subsidy: {
    thresholdExVat: 0.77,
    coveragePercent: 90,
    source: 'https://lovdata.no/dokument/SF/forskrift/2025-09-08-1791',
    note: '90 % av spotpris over 77 øre/kWh eks. mva, time for time. Ikke for hytter, og ikke sammen med Norgespris.',
  },
  electricityTax: {
    krPerKwhExVat: 0.0713,
    source: 'https://www.stortinget.no/no/Saker-og-publikasjoner/Vedtak/Vedtak/Sak/?did=40035803&p=104911',
    note: 'Alminnelig sats 7,13 øre/kWh i 2026. Husholdninger i tiltakssonen (Finnmark og sju kommuner i Troms) er fritatt – slå da av elavgift. Er ofte inkludert i nettleiens energiledd.',
  },
  business: {
    note: 'Norgespris og strømstøtte gjelder kun husholdninger. Mva-registrerte bedrifter får fradrag for inngående mva, så den reelle kostnaden er eks. mva.',
  },
  vat: {
    note: '25 % mva. Husholdninger i Nord-Norge (store deler av NO4) er fritatt for mva på strøm – bedrifter er ikke fritatt.',
  },
  gridFee: {
    note: 'Energileddet i nettleien varierer mellom nettselskap og tid på døgnet. Hent satsen fra ditt nettselskap.',
  },
} as const

export function defaultPriceSettings(area: PriceArea = 'NO1'): PriceSettings {
  return {
    area,
    customerType: 'bedrift',
    mode: 'spot',
    vatRatePercent: 25, // bedrift: mva gjelder også i NO4 (fritaket gjelder kun husholdninger)
    vatDeductible: true,
    norgespris: { enabled: true, krPerKwh: RATE_REFERENCES.norgespris.krPerKwhExVat, includesVat: false },
    fixedPrice: { enabled: true, krPerKwh: 1, includesVat: true },
    manualTotalKrPerKwh: 1.5,
    supplierMarkup: { enabled: false, krPerKwh: 0, includesVat: true },
    gridFee: { enabled: false, krPerKwh: 0, includesVat: true },
    electricityTax: {
      enabled: false,
      krPerKwh: RATE_REFERENCES.electricityTax.krPerKwhExVat,
      includesVat: false,
      includedInGridFee: true,
    },
    otherFees: { enabled: false, krPerKwh: 0, includesVat: true },
    subsidy: {
      enabled: true, // gjelder kun Privat – husholdninger får strømstøtte automatisk
      thresholdKrPerKwhExVat: RATE_REFERENCES.subsidy.thresholdExVat,
      coveragePercent: RATE_REFERENCES.subsidy.coveragePercent,
    },
    officialRates: 'auto',
  }
}

export function defaultSettings(): AppSettings {
  return {
    locale: 'nb-NO',
    currency: 'NOK',
    bakesPerMonth: 4,
    price: defaultPriceSettings('NO1'),
    plan: 'free',
    businessType: 'privat',
  }
}

/** Standard salgsfelt. Mva-satsen for næringsmidler må kontrolleres av brukeren. */
export function defaultSalesDraft() {
  return {
    pricePerUnit: 0,
    priceIncludesVat: true,
    vatRatePercent: 15,
    targetMarginPercent: 30,
    packagingPerUnit: 0,
    laborHours: 0,
    hourlyRate: 0,
  }
}

/**
 * Standardsatser for personalkostnader. Kunden må kontrollere dem:
 *  * arbeidsgiveravgift 14,1 % gjelder sone 1 (lavere i andre soner)
 *  * feriepenger 12 % ved fem ukers ferie (10,2 % etter ferieloven)
 *  * obligatorisk tjenestepensjon minst 2 %
 */
export function defaultStaffRole(id: string, name = 'Kokk'): StaffRole {
  return {
    id, name, mode: 'detaljert', hourlyWage: 250, employerTaxPercent: 14.1, holidayPayPercent: 12,
    pensionPercent: 2, otherPercent: 0, fixedHourlyCost: 0,
  }
}

/** Standardverdier for innkjøpsfeltene på en ingrediens (fase 4). */
export function ingredientExtras(): Pick<Ingredient, 'ean' | 'manufacturer' | 'supplierId' | 'supplierItemNo' | 'vatPercent' | 'wastePercent' | 'comment' | 'minStock'> {
  return { ean: '', manufacturer: '', supplierId: null, supplierItemNo: '', vatPercent: 15, wastePercent: 0, comment: '', minStock: null }
}

export function defaultCostSettings(): CostSettings {
  return { staffRoles: [], operatingCosts: [], includeContinuousEquipment: true, unitsPerMonth: 0 }
}

export function defaultEnergyInput(): EnergyInput {
  return {
    ovenWatt: 2500,
    temperatureC: 230,
    preheatMinutes: 15,
    preheatPowerPercent: 100,
    bakeMinutes: 45,
    bakePowerPercent: 55,
    rounds: 1,
    mixerWatt: 1000,
    mixerMinutes: 10,
    mixerPowerPercent: 60,
    otherEquipment: [],
    extraOvens: [],
    useMeasured: false,
    measuredKwh: 0,
  }
}
