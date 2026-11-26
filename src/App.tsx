import { Loader2, X } from 'lucide-react'
import { DataProvider } from './context/DataProvider'
import { PricesProvider } from './context/PricesProvider'
import { Layout } from './components/Layout'
import { useData } from './hooks/useData'
import { useRoute, type RouteKey } from './hooks/useRoute'
import { Overview } from './pages/Overview'
import { CalculatorPage } from './pages/CalculatorPage'
import { PricesPage } from './pages/PricesPage'
import { RecipesPage } from './pages/RecipesPage'
import { IngredientsPage } from './pages/IngredientsPage'
import { HistoryPage } from './pages/HistoryPage'
import { SalesPage } from './pages/SalesPage'
import { SettingsPage } from './pages/SettingsPage'

const PAGES: Record<RouteKey, () => React.JSX.Element> = {
  oversikt: Overview,
  kalkulator: CalculatorPage,
  strompriser: PricesPage,
  oppskrifter: RecipesPage,
  ingredienser: IngredientsPage,
  historikk: HistoryPage,
  salg: SalesPage,
  innstillinger: SettingsPage,
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
      {loading ? <div className="loading"><Loader2 className="spin" aria-hidden /> Laster …</div> : <Page />}
    </Layout>
  )
}

export default function App() {
  return (
    <DataProvider>
      <PricesProvider>
        <Routed />
      </PricesProvider>
    </DataProvider>
  )
}
