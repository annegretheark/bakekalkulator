import { useMemo, type ReactNode } from 'react'
import { Loader2, Lock, X } from 'lucide-react'
import { AuthProvider } from './context/AuthProvider'
import { DataProvider } from './context/DataProvider'
import { PricesProvider } from './context/PricesProvider'
import { Layout } from './components/Layout'
import { Notice, PageHeader } from './components/ui'
import { useData } from './hooks/useData'
import { useAuth } from './hooks/useAuth'
import { navigate, PROTECTED_ROUTES, useRoute, type RouteKey } from './hooks/useRoute'
import { localRepository, SupabaseRepository } from './services/storage'
import { Overview } from './pages/Overview'
import { CalculatorPage } from './pages/CalculatorPage'
import { PricesPage } from './pages/PricesPage'
import { RecipesPage } from './pages/RecipesPage'
import { IngredientsPage } from './pages/IngredientsPage'
import { HistoryPage } from './pages/HistoryPage'
import { SalesPage } from './pages/SalesPage'
import { SettingsPage } from './pages/SettingsPage'
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages'
import { AccountPage } from './pages/AccountPage'
import { AdminPage } from './pages/AdminPage'
import { PrivacyPage, TermsPage } from './pages/LegalPages'

const PAGES: Record<RouteKey, () => React.JSX.Element | null> = {
  oversikt: Overview,
  kalkulator: CalculatorPage,
  strompriser: PricesPage,
  oppskrifter: RecipesPage,
  ingredienser: IngredientsPage,
  historikk: HistoryPage,
  salg: SalesPage,
  innstillinger: SettingsPage,
  'logg-inn': LoginPage,
  registrer: RegisterPage,
  'glemt-passord': ForgotPasswordPage,
  'tilbakestill-passord': ResetPasswordPage,
  konto: AccountPage,
  admin: AdminPage,
  personvern: PrivacyPage,
  vilkar: TermsPage,
}

const TITLES: Partial<Record<RouteKey, string>> = { konto: 'Konto', admin: 'Administrasjon', salg: 'Salg og fortjeneste' }

/** Beskyttede sider krever innlogging når Supabase er satt opp. Tilgangen håndheves uansett i databasen. */
function Guard({ route, children }: { route: RouteKey; children: ReactNode }) {
  const { configured, user } = useAuth()
  if (configured && !user && PROTECTED_ROUTES.includes(route)) {
    return (
      <>
        <PageHeader title={TITLES[route] ?? 'Logg inn'} />
        <Notice><Lock size={14} /> Denne siden krever innlogging. <button className="link" onClick={() => navigate('logg-inn')}>Logg inn</button> eller <button className="link" onClick={() => navigate('registrer')}>opprett gratis konto</button> (30 dager Pro).</Notice>
      </>
    )
  }
  return <>{children}</>
}

function Routed() {
  const route = useRoute()
  const { loading, error, clearError } = useData()
  const Page = PAGES[route]
  return (
    <Layout route={route}>
      {error && (
        <div className="toast" role="alert">
          {error}
          <button className="icon-btn" onClick={clearError} aria-label="Lukk"><X size={16} /></button>
        </div>
      )}
      {loading ? <div className="loading"><Loader2 className="spin" aria-hidden /> Laster …</div> : <Guard route={route}><Page /></Guard>}
    </Layout>
  )
}

/**
 * Velger lagring: Supabase for innloggede brukere med aktiv organisasjon,
 * ellers localStorage (kalkulatoren kan brukes uten innlogging).
 */
function DataScope({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { client, user, activeOrg, plan } = auth
  const scope = useMemo(() => {
    if (client && user && activeOrg) {
      return { key: `sb:${user.id}:${activeOrg.id}:${plan}`, repository: new SupabaseRepository(client, activeOrg.id, user.id, plan) }
    }
    return { key: 'local', repository: localRepository }
  }, [client, user, activeOrg, plan])

  if (auth.loading) return <div className="loading full"><Loader2 className="spin" aria-hidden /> Laster …</div>
  return <DataProvider key={scope.key} repository={scope.repository}>{children}</DataProvider>
}

export default function App() {
  return (
    <AuthProvider>
      <DataScope>
        <PricesProvider>
          <Routed />
        </PricesProvider>
      </DataScope>
    </AuthProvider>
  )
}
