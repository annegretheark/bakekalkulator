// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { ROUTES } from '../hooks/useRoute'

const HEADINGS: Record<string, RegExp> = {
  oversikt: /God dag/,
  kalkulator: /^Bakekalkulator$/,
  strompriser: /^Strømpriser$/,
  oppskrifter: /^Mine oppskrifter$/,
  ingredienser: /^Ingredienser$/,
  utstyr: /^Utstyr$/,
  kostnader: /^Personal og drift$/,
  menyer: /^Menyer$/,
  skann: /^Skann$/,
  historikk: /^Bakehistorikk$/,
  salg: /^Salg og fortjeneste$/,
  innstillinger: /^Innstillinger$/,
}

beforeAll(() => {
  // Tving lokal modus – testene skal aldri kontakte den eksterne databasen
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const rows = Array.from({ length: 24 }, (_, h) => ({
    NOK_per_kWh: 1 + Math.sin(h / 3),
    time_start: new Date(start.getTime() + h * 3_600_000).toISOString(),
    time_end: new Date(start.getTime() + (h + 1) * 3_600_000).toISOString(),
  }))
  let call = 0
  vi.stubGlobal('fetch', vi.fn(async () => (call++ % 2 === 0
    ? new Response(JSON.stringify(rows), { status: 200 })
    : new Response('Not found', { status: 404 }))))
  window.scrollTo = () => {}
})

afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('appen', () => {
  it('rendrer alle sider uten feil', async () => {
    render(<App />)
    for (const route of ROUTES) {
      await act(async () => {
        window.location.hash = `/${route}`
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })
      expect(await screen.findByRole('heading', { level: 1, name: HEADINGS[route] })).toBeTruthy()
    }
  })

  it('kontosider fungerer i lokal modus uten innlogging', async () => {
    const pages: [string, RegExp][] = [['logg-inn', /^Logg inn$/], ['registrer', /^Opprett konto$/], ['personvern', /^Personvernerklæring$/], ['vilkar', /^Brukervilkår$/]]
    for (const [route, heading] of pages) {
      await act(async () => { window.location.hash = `/${route}`; window.dispatchEvent(new HashChangeEvent('hashchange')) })
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy()
      if (route === 'logg-inn') expect(screen.getAllByText(/Innlogging er ikke satt opp/).length).toBeGreaterThan(0)
    }
  })

  it('kalkulatoren har valg for privat eller bedrift som oppdaterer strømoppsettet', async () => {
    await act(async () => { window.location.hash = '/kalkulator'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    const group = await screen.findByRole('radiogroup', { name: 'Kundetype' })
    const privat = within(group).getByRole('radio', { name: 'Privat' })
    const bedrift = within(group).getByRole('radio', { name: 'Bedrift' })
    expect(bedrift.getAttribute('aria-checked')).toBe('true')
    await act(async () => { privat.click() })
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Kundetype' })).getByRole('radio', { name: 'Privat' }).getAttribute('aria-checked')).toBe('true'))
    // Samme innstilling vises på strømprissiden
    await act(async () => { window.location.hash = '/strompriser'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Kundetype' })).getByRole('radio', { name: 'Privat' }).getAttribute('aria-checked')).toBe('true'))
    await act(async () => { within(screen.getByRole('radiogroup', { name: 'Kundetype' })).getByRole('radio', { name: 'Bedrift' }).click() })
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Kundetype' })).getByRole('radio', { name: 'Bedrift' }).getAttribute('aria-checked')).toBe('true'))
  })

  it('bedrift får pris og fortjeneste på kalkulatorsiden; privat ser det ikke', async () => {
    const go = async (r: string) => act(async () => { window.location.hash = `/${r}`; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    const kundetype = (name: 'Privat' | 'Bedrift') => within(screen.getByRole('radiogroup', { name: 'Kundetype' })).getByRole('radio', { name })
    await go('kalkulator')
    await screen.findByRole('radiogroup', { name: 'Kundetype' })
    if (kundetype('Bedrift').getAttribute('aria-checked') !== 'true') await act(async () => { kundetype('Bedrift').click() })
    expect(await screen.findByRole('heading', { name: /^Pris og fortjeneste$/, level: 2 })).toBeTruthy()
    // Uten utsalgspris: anbefalt pris vises, fortjeneste ikke
    expect(screen.getByText(/Anbefalt pris \(30 % margin\)/)).toBeTruthy()
    expect(screen.queryByText(/^Fortjenestemargin$/)).toBeNull()
    // Fyll inn utsalgspris → fortjeneste, margin og påslag vises
    const price = screen.getByLabelText(/Utsalgspris per stk/) as HTMLInputElement
    await act(async () => { fireEvent.change(price, { target: { value: '80' } }) })
    await waitFor(() => expect(screen.getByText(/^Fortjenestemargin$/)).toBeTruthy())
    expect(screen.getByText(/^Påslag$/)).toBeTruthy()
    // Salgssiden starter med samme utsalgspris
    await go('salg')
    const salesPrice = await screen.findByLabelText(/Utsalgspris per stk/) as HTMLInputElement
    expect(salesPrice.value).toBe('80')
    // Privat: kortet vises ikke
    await go('kalkulator')
    await screen.findByRole('radiogroup', { name: 'Kundetype' })
    await act(async () => { kundetype('Privat').click() })
    await waitFor(() => expect(screen.queryByRole('heading', { name: /^Pris og fortjeneste$/, level: 2 })).toBeNull())
    await act(async () => { kundetype('Bedrift').click() })
  })

  it('viser eksempeloppskriften med tre grovbrød', async () => {
    await act(async () => { window.location.hash = '/oppskrifter'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    expect((await screen.findAllByText('Tre grove brød')).length).toBeGreaterThan(0)
  })

  it('har skanning av oppskrift, kvittering og strekkode (åpent i lokal modus)', async () => {
    const go = async (r: string) => act(async () => { window.location.hash = `/${r}`; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await go('oppskrifter')
    await act(async () => { (await screen.findByRole('button', { name: /Skann oppskrift/ })).click() })
    expect(await screen.findByRole('heading', { level: 2, name: /Skann oppskrift/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Ta bilde \/ velg bilder/ })).toBeTruthy()
    expect(screen.queryByText(/er med i Pro/)).toBeNull()

    await go('ingredienser')
    await act(async () => { (await screen.findByRole('button', { name: /Skann ingrediens/ })).click() })
    expect(await screen.findByRole('button', { name: /Skann strekkode/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Registrer manuelt/ })).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: /Skann kvittering/ }).click() })
    expect(await screen.findByRole('heading', { level: 2, name: /Skann kvittering eller faktura/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Ta bilde$/ })).toBeTruthy()

    // Skann-siden har de fire valgene. Uten innlogging vises ikke AI-tolkning.
    await go('skann')
    for (const name of [/Skann ingrediens/, /Skann oppskrift/, /Skann kvittering eller faktura/, /Last opp bilde/]) {
      expect(await screen.findByRole('button', { name })).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: /Tolk med AI/ })).toBeNull()
    await act(async () => { screen.getByRole('button', { name: /Last opp bilde/ }).click() })
    await act(async () => { screen.getByRole('button', { name: /Bilde av oppskrift/ }).click() })
    expect(await screen.findByRole('button', { name: /Velg bilder/ })).toBeTruthy()
  })
})
