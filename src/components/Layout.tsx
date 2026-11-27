import { useState, type ReactNode } from 'react'
import { BookOpen, Calculator, ChartColumn, ClipboardList, Gauge, History, Recycle, ScanLine, Truck, Warehouse, LayoutDashboard, LogIn, Menu, Settings, WifiOff, Shield, ShoppingBasket, UserRound, Users, Wheat, Wrench, X, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { navigate, type RouteKey } from '../hooks/useRoute'
import { useData, useFormat, useT } from '../hooks/useData'
import { usePriceData } from '../hooks/usePriceData'
import type { TranslationKey } from '../locales'
import { AREA_NAMES } from '../lib/defaults'
import { formatOre } from '../utils/format'
import { useAuth } from '../hooks/useAuth'
import { useOnline } from '../hooks/useOnline'
import { PLAN_NAMES, trialDaysLeft } from '../lib/plans'
import { businessProfile } from '../lib/businessTypes'

const NAV: { key: RouteKey; label: TranslationKey; icon: LucideIcon }[] = [
  { key: 'oversikt', label: 'nav.overview', icon: LayoutDashboard },
  { key: 'dashboard', label: 'nav.dashboard', icon: Gauge },
  { key: 'kalkulator', label: 'nav.calculator', icon: Calculator },
  { key: 'strompriser', label: 'nav.prices', icon: Zap },
  { key: 'oppskrifter', label: 'nav.recipes', icon: BookOpen },
  { key: 'ingredienser', label: 'nav.ingredients', icon: ShoppingBasket },
  { key: 'leverandorer', label: 'nav.suppliers', icon: Truck },
  { key: 'lager', label: 'nav.stock', icon: Warehouse },
  { key: 'svinn', label: 'nav.waste', icon: Recycle },
  { key: 'utstyr', label: 'nav.equipment', icon: Wrench },
  { key: 'kostnader', label: 'nav.costs', icon: Users },
  { key: 'menyer', label: 'nav.menus', icon: ClipboardList },
  { key: 'skann', label: 'nav.scan', icon: ScanLine },
  { key: 'historikk', label: 'nav.history', icon: History },
  { key: 'salg', label: 'nav.sales', icon: ChartColumn },
  { key: 'innstillinger', label: 'nav.settings', icon: Settings },
]


export function Layout({ route, children }: { route: RouteKey; children: ReactNode }) {
  const t = useT()
  const { data } = useData()
  const { locale } = useFormat()
  const prices = usePriceData()
  const [open, setOpen] = useState(false)
  const area = data.settings.price.area
  const auth = useAuth()
  const online = useOnline()
  const profile = businessProfile(data.settings.businessType)
  // Kalkulator og historikk får navn etter virksomhetstypen
  const navLabel = (key: RouteKey, fallback: TranslationKey) =>
    key === 'kalkulator' ? profile.calculatorName : key === 'historikk' ? profile.historyName : t(fallback)
  const days = trialDaysLeft(auth.activeOrg?.subscription)
  // Ikke innlogget (med Supabase): appen er låst, så menyen skjules
  const locked = auth.configured && !auth.user

  const go = (k: RouteKey) => { setOpen(false); navigate(k) }

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Hovedmeny">
        <div className="brand">
          <span className="brand-mark"><Wheat size={22} aria-hidden /></span>
          <span>
            <strong>{t('app.name')}</strong>
            <small>{t('app.subtitle')}</small>
          </span>
          <button className="icon-btn only-mobile" onClick={() => setOpen(false)} aria-label="Lukk meny"><X size={20} /></button>
        </div>
        {!locked && <nav>
          {NAV.filter((n) => !profile.hiddenRoutes.includes(n.key as never)).map(({ key, label, icon: Icon }) => (
            <a key={key} href={`#/${key}`} className={route === key ? 'active' : ''} aria-current={route === key ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(key) }}>
              <Icon size={18} aria-hidden /> {navLabel(key, label)}
            </a>
          ))}
        </nav>}
        {auth.configured && (
          <div className="account-box">
            {auth.user ? (
              <>
                <a href="#/konto" className={route === 'konto' ? 'active' : ''} onClick={(e) => { e.preventDefault(); go('konto') }}>
                  <UserRound size={18} aria-hidden />
                  <span>
                    {auth.context?.profile?.full_name ?? auth.user.email}
                    <small>{auth.activeOrg?.name} · {PLAN_NAMES[auth.plan]}{days ? ` (prøve: ${days} d)` : ''}</small>
                  </span>
                </a>
                {auth.isAdmin && (
                  <a href="#/admin" className={route === 'admin' ? 'active' : ''} onClick={(e) => { e.preventDefault(); go('admin') }}>
                    <Shield size={18} aria-hidden /> Administrasjon
                  </a>
                )}
              </>
            ) : (
              <>
                <a href="#/logg-inn" className={route === 'logg-inn' ? 'active' : ''} onClick={(e) => { e.preventDefault(); go('logg-inn') }}>
                  <LogIn size={18} aria-hidden /> <span>Logg inn</span>
                </a>
                <a href="#/registrer" className={route === 'registrer' ? 'active' : ''} onClick={(e) => { e.preventDefault(); go('registrer') }}>
                  <UserRound size={18} aria-hidden /> <span>Opprett konto<small>30 dager gratis Pro</small></span>
                </a>
              </>
            )}
          </div>
        )}
        <div className="sidebar-foot">
          <Zap size={16} aria-hidden />
          <div>
            <small>{area} – {AREA_NAMES[area]}</small>
            <strong>{prices.currentTotal !== null ? formatOre(prices.currentTotal, locale) : prices.loading ? 'Henter pris …' : 'Pris mangler'}</strong>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}

      <div className="main">
        <header className="topbar only-mobile">
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Åpne meny"><Menu size={22} /></button>
          <span className="brand-inline"><Wheat size={18} aria-hidden /> {t('app.name')}</span>
          <span className="topbar-price">{prices.currentTotal !== null ? formatOre(prices.currentTotal, locale) : ''}</span>
        </header>
        {!online && (
          <div className="notice notice-warn offline-banner" role="status">
            <WifiOff size={18} aria-hidden />
            <span>Du er uten nett. Det som allerede er lastet vises fortsatt, men lagring, strømpriser og strekkodeoppslag virker først når du er på nett igjen.</span>
          </div>
        )}
        <main className="content">{children}</main>
        {!locked && <nav className="tabbar only-mobile" aria-label="Snarveier">
          {NAV.filter((n) => profile.mobileTabs.includes(n.key as never)).map(({ key, label, icon: Icon }) => (
            <a key={key} href={`#/${key}`} className={route === key ? 'active' : ''} onClick={(e) => { e.preventDefault(); go(key) }}>
              <Icon size={20} aria-hidden />
              <span>{navLabel(key, label).replace('Mine ', '').replace('Produksjonshistorikk', 'Historikk')}</span>
            </a>
          ))}
          <button type="button" onClick={() => setOpen(true)}><Menu size={20} aria-hidden /><span>Mer</span></button>
        </nav>}
      </div>
    </div>
  )
}
