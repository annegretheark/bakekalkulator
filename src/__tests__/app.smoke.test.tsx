// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import App from '../App'
import { ROUTES } from '../hooks/useRoute'

const HEADINGS: Record<string, RegExp> = {
  oversikt: /God dag/,
  kalkulator: /^Bakekalkulator$/,
  strompriser: /^Strømpriser$/,
  oppskrifter: /^Mine oppskrifter$/,
  ingredienser: /^Ingredienser$/,
  historikk: /^Bakehistorikk$/,
  salg: /^Salg og fortjeneste$/,
  innstillinger: /^Innstillinger$/,
}

beforeAll(() => {
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

afterAll(() => vi.unstubAllGlobals())

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

  it('viser eksempeloppskriften med tre grovbrød', async () => {
    await act(async () => { window.location.hash = '/oppskrifter'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    expect((await screen.findAllByText('Tre grove brød')).length).toBeGreaterThan(0)
  })
})
