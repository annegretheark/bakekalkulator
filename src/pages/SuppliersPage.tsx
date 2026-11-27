import { Fragment, useState } from 'react'
import { Pencil, Plus, Trash2, Truck } from 'lucide-react'
import type { Supplier } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { Card, EmptyState, PageHeader, TextField } from '../components/ui'
import { formatMoney, uid } from '../utils/format'
import { pricePerBaseUnit } from '../utils/inventory'

const blank = (): Supplier => ({ id: uid(), name: '', contactPerson: '', phone: '', email: '', customerNumber: '', comment: '' })

/** Leverandørregister. Ingrediensene kobles til leverandør under Ingredienser. */
export function SuppliersPage() {
  const f = useFormat()
  const { data, upsertSupplier, deleteSupplier } = useData()
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const itemsOf = (id: string) => data.ingredients.filter((i) => i.supplierId === id)
  const set = (p: Partial<Supplier>) => editing && setEditing({ ...editing, ...p })
  const remove = (s: Supplier) => {
    const n = itemsOf(s.id).length
    if (confirm(n ? `${s.name} er leverandør for ${n} ingrediens(er). De beholder prisen, men mister koblingen. Slette likevel?` : `Slette ${s.name}?`)) deleteSupplier(s.id)
  }

  return (
    <>
      <PageHeader title="Leverandører" description="Hvem dere kjøper fra. Koble ingrediensene til leverandør, og sammenlign priser under Ingredienser."
        actions={<button className="btn primary" onClick={() => setEditing(blank())}><Plus size={18} /> Ny leverandør</button>} />

      {editing && (
        <Card title={data.suppliers.some((s) => s.id === editing.id) ? 'Rediger leverandør' : 'Ny leverandør'} icon={Truck}>
          <div className="form-grid">
            <TextField label="Navn" required value={editing.name} onChange={(v) => set({ name: v })} placeholder="F.eks. ASKO, Servicegrossistene, lokal baker" />
            <TextField label="Kontaktperson" value={editing.contactPerson} onChange={(v) => set({ contactPerson: v })} />
            <TextField label="Telefon" type="tel" value={editing.phone} onChange={(v) => set({ phone: v })} />
            <TextField label="E-post" type="email" value={editing.email} onChange={(v) => set({ email: v })} />
            <TextField label="Kundenummer hos leverandøren" value={editing.customerNumber} onChange={(v) => set({ customerNumber: v })} />
            <TextField label="Kommentar" value={editing.comment} onChange={(v) => set({ comment: v })} placeholder="Leveringsdager, minstebestilling …" />
          </div>
          <div className="actions">
            <button className="btn primary" disabled={!editing.name.trim()} onClick={async () => { await upsertSupplier({ ...editing, name: editing.name.trim() }); setEditing(null) }}>Lagre</button>
            <button className="btn ghost" onClick={() => setEditing(null)}>Avbryt</button>
          </div>
        </Card>
      )}

      {data.suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="Ingen leverandører ennå" text="Legg inn grossister og butikker dere handler hos. Da kan dere se prishistorikk og sammenligne priser per leverandør."
          action={<button className="btn primary" onClick={() => setEditing(blank())}><Plus size={18} /> Ny leverandør</button>} />
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="clean responsive">
              <thead><tr><th>Leverandør</th><th>Kontakt</th><th>Kundenr.</th><th className="num">Varer</th><th /></tr></thead>
              <tbody>
                {data.suppliers.map((s) => {
                  const items = itemsOf(s.id)
                  return (
                    <Fragment key={s.id}>
                      <tr>
                        <td data-label="Leverandør"><strong>{s.name}</strong>{s.comment && <small className="muted block">{s.comment}</small>}</td>
                        <td data-label="Kontakt">{[s.contactPerson, s.phone, s.email].filter(Boolean).join(' · ') || <span className="muted">–</span>}</td>
                        <td data-label="Kundenr.">{s.customerNumber || <span className="muted">–</span>}</td>
                        <td data-label="Varer" className="num">
                          {items.length ? <button className="link" onClick={() => setOpen(open === s.id ? null : s.id)}>{items.length}</button> : 0}
                        </td>
                        <td className="row-actions">
                          <button className="icon-btn" aria-label={`Rediger ${s.name}`} onClick={() => setEditing(s)}><Pencil size={16} /></button>
                          <button className="icon-btn danger" aria-label={`Slett ${s.name}`} onClick={() => remove(s)}><Trash2 size={16} /></button>
                        </td>
                      </tr>
                      {open === s.id && (
                        <tr className="sub-row">
                          <td colSpan={5}>
                            <ul className="plain-list">
                              {items.map((i) => {
                                const per = pricePerBaseUnit(i)
                                return <li key={i.id}>{i.name}{i.supplierItemNo ? ` (varenr. ${i.supplierItemNo})` : ''}: {formatMoney(i.price, f)} for {i.packageSize} {i.unit}{per ? ` · ${formatMoney(per.value, f)}/${per.unit}` : ''}</li>
                              })}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
