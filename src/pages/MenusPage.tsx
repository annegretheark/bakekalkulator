import { useState } from 'react'
import { ArrowLeft, ClipboardList, Pencil, Plus, Printer, ShieldAlert, Trash2 } from 'lucide-react'
import { ALLERGEN_CODES, MENU_TYPES, type Menu, type MenuItem, type MenuType } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { useCostContext, useReferencePrice } from '../hooks/useRecipeCosts'
import { Card, EmptyState, Notice, NumberField, PageHeader, SelectField, TextField } from '../components/ui'
import { ALLERGEN_SHORT, ALLERGEN_STATUS_NAMES } from '../lib/allergens'
import { formatMoney, formatPercent, uid } from '../utils/format'
import { menuSummary, priceForMargin, type MenuItemCalc } from '../utils/menu'
import { navigate } from '../hooks/useRoute'

const MENU_TYPE_NAMES: Record<MenuType, string> = {
  frokost: 'Frokostmeny',
  lunsj: 'Lunsjmeny',
  middag: 'Middagsmeny',
  dagens: 'Dagens rett',
  catering: 'Cateringmeny',
  sesong: 'Sesongmeny',
  egen: 'Egen meny',
}

const newMenu = (): Menu => {
  const now = new Date().toISOString()
  return { id: uid(), name: '', type: 'lunsj', description: '', items: [], createdAt: now, updatedAt: now }
}

/** Symbol i allergenoversikten. Forklaring står under tabellen. */
const STATUS_MARK = { inneholder: '●', spor: 'S', krysskontakt: 'K', ukjent: '?', fri: '' } as const

export function MenusPage() {
  const f = useFormat()
  const { data, upsertMenu, deleteMenu } = useData()
  const ctx = useCostContext()
  const { source } = useReferencePrice()
  const [editing, setEditing] = useState<Menu | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [target, setTarget] = useState(70)

  // ---------- Redigering ----------
  if (editing) {
    const m = editing
    const set = (p: Partial<Menu>) => setEditing({ ...m, ...p })
    const setItem = (id: string, p: Partial<MenuItem>) => set({ items: m.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })
    const valid = m.name.trim() && m.items.every((i) => i.recipeId)
    const sum = menuSummary(m, ctx)
    return (
      <>
        <PageHeader title={data.menus.some((x) => x.id === m.id) ? 'Rediger meny' : 'Ny meny'}
          actions={<button className="btn ghost" onClick={() => setEditing(null)}><ArrowLeft size={16} /> Tilbake</button>} />
        <Card title="Meny" icon={ClipboardList}>
          <div className="form-grid">
            <TextField label="Navn" required value={m.name} onChange={(v) => set({ name: v })} placeholder="F.eks. Lunsj høst" />
            <SelectField<MenuType> label="Type" value={m.type} onChange={(v) => set({ type: v })} options={MENU_TYPES.map((t) => ({ value: t, label: MENU_TYPE_NAMES[t] }))} />
            <TextField label="Beskrivelse" value={m.description} onChange={(v) => set({ description: v })} />
          </div>
        </Card>
        <Card title="Retter">
          {data.recipes.length === 0 && <Notice tone="warn">Du har ingen oppskrifter ennå. <button className="link" onClick={() => navigate('oppskrifter')}>Lag en oppskrift</button> først.</Notice>}
          {m.items.map((it, idx) => {
            const calc = sum.items[idx]
            return (
              <div key={it.id} className="menu-item-row">
                <SelectField label={idx === 0 ? 'Oppskrift' : ''} value={it.recipeId} onChange={(v) => setItem(it.id, { recipeId: v })}
                  options={[{ value: '', label: '— Velg —' }, ...data.recipes.map((r) => ({ value: r.id, label: r.name })),
                    ...(it.recipeId && !data.recipes.some((r) => r.id === it.recipeId) ? [{ value: it.recipeId, label: 'Slettet oppskrift' }] : [])]} />
                <TextField label={idx === 0 ? 'Navn på menyen' : ''} value={it.name} onChange={(v) => setItem(it.id, { name: v })} placeholder={calc.recipe?.name ?? ''} />
                <NumberField label={idx === 0 ? 'Pris inkl. mva' : ''} value={it.price} max={1000000} onChange={(v) => setItem(it.id, { price: v })} suffix="kr" />
                <SelectField label={idx === 0 ? 'Mva' : ''} value={String(it.vatPercent)} onChange={(v) => setItem(it.id, { vatPercent: Number(v) })}
                  options={[{ value: '15', label: '15 % (ta med)' }, { value: '25', label: '25 % (servering)' }, { value: '0', label: '0 %' },
                    ...(![0, 15, 25].includes(it.vatPercent) ? [{ value: String(it.vatPercent), label: `${it.vatPercent} %` }] : [])]} />
                <span className="num row-cost" title="Kostnad per porsjon">{formatMoney(calc.cost?.total ?? null, f)}</span>
                <button className="icon-btn danger" aria-label="Fjern rett" onClick={() => set({ items: m.items.filter((x) => x.id !== it.id) })}><Trash2 size={16} /></button>
              </div>
            )
          })}
          <button className="btn ghost" disabled={data.recipes.length === 0}
            onClick={() => set({ items: [...m.items, { id: uid(), recipeId: data.recipes[0]?.id ?? '', name: '', price: 0, vatPercent: m.type === 'catering' ? 15 : 25 }] })}>
            <Plus size={16} /> Legg til rett
          </button>
          <p className="muted small">Mva: 25 % for servering, 15 % for mat som tas med. Kontroller satsen for deres virksomhet.</p>
        </Card>
        <div className="actions">
          <button className="btn primary" disabled={!valid} onClick={async () => {
            await upsertMenu({ ...m, name: m.name.trim(), updatedAt: new Date().toISOString() })
            setEditing(null)
            setViewing(m.id)
          }}>Lagre meny</button>
          <button className="btn ghost" onClick={() => setEditing(null)}>Avbryt</button>
        </div>
      </>
    )
  }

  // ---------- Visning ----------
  const shown = viewing ? data.menus.find((x) => x.id === viewing) : null
  if (shown) {
    const sum = menuSummary(shown, ctx)
    const warnings = [...new Set(sum.items.flatMap((i) => i.warnings.map((w) => `${i.name}: ${w}`)))]
    const unchecked = sum.items.some((i) => i.uncheckedAllergens)
    return (
      <>
        <PageHeader title={shown.name} description={[MENU_TYPE_NAMES[shown.type], shown.description].filter(Boolean).join(' · ')}
          actions={<>
            <button className="btn ghost no-print" onClick={() => setViewing(null)}><ArrowLeft size={16} /> Alle menyer</button>
            <button className="btn ghost no-print" onClick={() => setEditing(structuredClone(shown))}><Pencil size={16} /> Rediger</button>
            <button className="btn primary no-print" onClick={() => window.print()}><Printer size={16} /> Skriv ut allergenoversikt</button>
          </>} />

        <Card title="Kalkulasjon per porsjon" icon={ClipboardList} className="no-print">
          {sum.items.length === 0 ? <p className="muted">Ingen retter på menyen.</p> : (
            <div className="table-wrap">
              <table className="clean responsive menu-table">
                <thead>
                  <tr>
                    <th>Rett</th><th className="num">Råvarer</th><th className="num">Energi</th><th className="num">Personal</th>
                    <th className="num">Embal&shy;lasje</th><th className="num">Drift</th><th className="num">Kostnad</th>
                    <th className="num">Pris eks. mva</th><th className="num">Fort&shy;jeneste</th><th className="num">Margin</th><th className="num">Råvare&shy;andel</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.items.map((i) => <MenuRow key={i.item.id} calc={i} />)}
                </tbody>
              </table>
            </div>
          )}
          <dl className="kv">
            <dt>Snittmargin</dt><dd>{sum.avgMarginPercent === null ? '–' : formatPercent(sum.avgMarginPercent, f.locale)}</dd>
            <dt>Snitt råvareandel</dt><dd>{sum.avgFoodCostPercent === null ? '–' : formatPercent(sum.avgFoodCostPercent, f.locale)}</dd>
          </dl>
          {warnings.length > 0 && <Notice tone="warn">{warnings.slice(0, 6).join('. ')}{warnings.length > 6 ? ' …' : ''}</Notice>}
          <p className="muted small">Energi regnes med {source}. Driftskostnader fordeles etter antall per måned under Personal og drift. Svinn kommer i en senere versjon.</p>
        </Card>

        <Card title="Prisforslag" className="no-print">
          <div className="form-grid">
            <NumberField label="Ønsket margin" value={target} max={95} onChange={setTarget} suffix="%" hint="Fortjeneste i prosent av pris eks. mva" />
          </div>
          <div className="table-wrap">
            <table className="clean responsive">
              <thead><tr><th>Rett</th><th className="num">Kostnad</th><th className="num">Pris nå</th><th className="num">Forslag inkl. mva</th></tr></thead>
              <tbody>
                {sum.items.filter((i) => i.cost).map((i) => (
                  <tr key={i.item.id}>
                    <td data-label="Rett"><strong>{i.name}</strong></td>
                    <td data-label="Kostnad" className="num">{formatMoney(i.cost!.total, f)}</td>
                    <td data-label="Pris nå" className="num">{i.item.price ? formatMoney(i.item.price, f) : '–'}</td>
                    <td data-label="Forslag inkl. mva" className="num"><strong>{formatMoney(priceForMargin(i.cost!.total, target, i.item.vatPercent), f)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Allergenoversikt" icon={ShieldAlert} className="print-area">
          <h2 className="print-only">{shown.name} – allergener</h2>
          <div className="table-wrap">
            <table className="clean allergen-table">
              <thead>
                <tr><th>Rett</th>{ALLERGEN_CODES.map((c) => <th key={c} className="rot"><span>{ALLERGEN_SHORT[c]}</span></th>)}</tr>
              </thead>
              <tbody>
                {sum.items.map((i) => (
                  <tr key={i.item.id}>
                    <td>{i.name}</td>
                    {ALLERGEN_CODES.map((c) => {
                      const st = i.allergens[c]
                      return <td key={c} className={`mark allergen-${st}`} title={`${ALLERGEN_SHORT[c]}: ${ALLERGEN_STATUS_NAMES[st]}`}>{STATUS_MARK[st]}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small">
            ● Inneholder · S Kan inneholde spor · K Risiko for krysskontakt · ? Ukjent – spør personalet · Tom rute: inneholder ikke (kontrollert)
          </p>
          <p className="small muted">Spør oss gjerne om allergener og ingredienser. Oversikten er laget fra registrerte ingredienser {new Date().toLocaleDateString(f.locale)}.</p>
          {unchecked && <Notice tone="warn">Noen allergenopplysninger er ikke kontrollert av dere. Kontroller dem før oversikten brukes overfor gjester.</Notice>}
        </Card>
      </>
    )
  }

  // ---------- Liste ----------
  return (
    <>
      <PageHeader title="Menyer" description="Sett sammen retter til menyer og se kostnad, fortjeneste og allergener per rett."
        actions={<button className="btn primary" onClick={() => setEditing(newMenu())}><Plus size={18} /> Ny meny</button>} />
      {data.menus.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Ingen menyer ennå" text="Lag en frokost-, lunsj- eller middagsmeny fra oppskriftene dine. Du får kalkulasjon per rett og en utskriftsvennlig allergenoversikt."
          action={<button className="btn primary" onClick={() => setEditing(newMenu())}><Plus size={18} /> Ny meny</button>} />
      ) : (
        <div className="cards-grid">
          {data.menus.map((m) => {
            const sum = menuSummary(m, ctx)
            return (
              <article key={m.id} className="recipe-card">
                <button className="recipe-main" onClick={() => setViewing(m.id)}>
                  <span className="pill">{MENU_TYPE_NAMES[m.type]}</span>
                  <h3>{m.name}</h3>
                  <p className="muted small">{m.items.length} {m.items.length === 1 ? 'rett' : 'retter'}{m.description ? ` · ${m.description}` : ''}</p>
                  <div className="recipe-figures">
                    <span><small>Snittmargin</small><strong>{sum.avgMarginPercent === null ? '–' : formatPercent(sum.avgMarginPercent, f.locale)}</strong></span>
                    <span><small>Råvareandel</small><strong>{sum.avgFoodCostPercent === null ? '–' : formatPercent(sum.avgFoodCostPercent, f.locale)}</strong></span>
                  </div>
                </button>
                <div className="recipe-actions">
                  <button className="icon-btn" aria-label="Rediger" title="Rediger" onClick={() => setEditing(structuredClone(m))}><Pencil size={16} /></button>
                  <button className="icon-btn danger" aria-label="Slett" title="Slett" onClick={() => confirm(`Slette menyen «${m.name}»? Oppskriftene beholdes.`) && deleteMenu(m.id)}><Trash2 size={16} /></button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}

function MenuRow({ calc: i }: { calc: MenuItemCalc }) {
  const f = useFormat()
  const c = i.cost
  const tone = i.marginPercent === null ? '' : i.marginPercent < 0 ? 'neg' : i.marginPercent < 20 ? 'warn-text' : 'pos'
  return (
    <tr className={c ? '' : 'warn-row'}>
      <td data-label="Rett"><strong>{i.name}</strong>{!c && <small className="error block">Oppskriften er slettet</small>}</td>
      <td data-label="Råvarer" className="num">{formatMoney(c?.ingredients ?? null, f)}</td>
      <td data-label="Energi" className="num">{formatMoney(c?.energy ?? null, f)}</td>
      <td data-label="Personal" className="num">{formatMoney(c?.labor ?? null, f)}</td>
      <td data-label="Emballasje" className="num">{formatMoney(c?.packaging ?? null, f)}</td>
      <td data-label="Drift" className="num">{formatMoney(c?.overhead ?? null, f)}</td>
      <td data-label="Kostnad" className="num"><strong>{formatMoney(c?.total ?? null, f)}</strong></td>
      <td data-label="Pris eks. mva" className="num">{i.item.price ? formatMoney(i.priceExVat, f) : '–'}</td>
      <td data-label="Fortjeneste" className={`num ${tone}`}>{i.profit === null ? '–' : formatMoney(i.profit, f)}</td>
      <td data-label="Margin" className={`num ${tone}`}>{i.marginPercent === null ? '–' : formatPercent(i.marginPercent, f.locale)}</td>
      <td data-label="Råvareandel" className="num">{i.foodCostPercent === null ? '–' : formatPercent(i.foodCostPercent, f.locale)}</td>
    </tr>
  )
}
