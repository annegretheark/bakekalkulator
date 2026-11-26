// Node 25 har et eksperimentelt globalt localStorage som uten --localstorage-file
// mangler metoder (setItem m.fl.) og skygger for jsdom sitt. Testene får da et
// enkelt localStorage i minnet. Påvirker kun testkjøringen, ikke appen.
class MemoryStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const current = (globalThis as Record<string, unknown>)[name] as Storage | undefined
  if (!current || typeof current.setItem !== 'function') {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true })
  }
}
