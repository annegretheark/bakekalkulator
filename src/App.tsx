import { useMemo, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { AuthProvider } from './context/AuthProvider'
import { DataProvider } from './context/DataProvider'
import { PricesProvider } from './context/PricesProvider'
import { Layout } from './components/Layout'
import { useData } from './hooks/useData'
import { useAuth } from './hooks/useAuth'
import { requiresLogin, useRoute, type RouteKey } from './hooks/useRoute'
import { localRepository, SupabaseRepository } from './services/storage'
import { Overview } from './pages/Overview'
import { CalculatorPage } from './pages/CalculatorPage'
import { PricesPage } from './pages/PricesPage'
import { RecipesPage } from './pages/RecipesPage'
import { IngredientsPage } from './pages/IngredientsPage'
import { EquipmentPage } from './pages/EquipmentPage'
import { CostsPage } from './pages/CostsPage'
import { MenusPage } from './pages/MenusPage'
import { ScanPage } from './pages/ScanPage'
import { SuppliersPage } from './pages/SuppliersPage'
import { StockPage } from './pages/StockPage'
import { WastePage } from './pages/WastePage'
import { DashboardPage } from './pages/DashboardPage'
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
  utstyr: EquipmentPage,
  kostnader: CostsPage,
  menyer: MenusPage,
  skann: ScanPage,
  leverandorer: SuppliersPage,
  lager: StockPage,
  svinn: WastePage,
  dashboard: DashboardPage,
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

/**
 * Når Supabase er satt opp, krever appen innlogging: alle sider unntatt innlogging,
 * registrering, passord og juridiske sider viser innloggingen i stedet. Etter
 * innlogging vises siden brukeren prøvde å åpne. Tilgangen håndheves uansett i databasen.
 */
function Guard({ route, children }: { route: RouteKey; children: ReactNode }) {
  const { configured, user } = useAuth()
  if (configured && !user && requiresLogin(route)) return <LoginPage />
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
 * ellers localStorage (lokal modus uten Supabase; med Supabase vises bare innloggingen).
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
