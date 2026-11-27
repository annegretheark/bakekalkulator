// Husker e-postadressen fra siste vellykkede innlogging på denne enheten, slik at
// brukeren bare trenger å skrive passordet hvis de en sjelden gang må logge inn igjen.
// Lagres kun i nettleseren. Fjernes når kontoen slettes.
const KEY = 'rettilomma.bakekalkulator.lastEmail'

export function readLastEmail(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberEmail(email: string): void {
  try {
    const v = email.trim()
    if (v) localStorage.setItem(KEY, v)
  } catch {
    // Lagring kan være blokkert (privat modus) – da huskes ikke adressen
  }
}

export function forgetEmail(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignorer
  }
}
