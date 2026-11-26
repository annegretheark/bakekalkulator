// Kjører tests/pg mot EKTE PostgreSQL.
//
// * Er PG_TEST_URL satt, brukes den (f.eks. lokal Supabase:
//   postgresql://postgres:postgres@localhost:54322/postgres). Testene lager og
//   sletter egne databaser – pek ALDRI mot produksjon.
// * Ellers startes en midlertidig, isolert klynge med initdb i en temp-mappe på
//   en egen port (kun 127.0.0.1, trust-autentisering), som stoppes og slettes etterpå.
//   Eksisterende PostgreSQL-installasjoner og databaser røres ikke.
//
// PostgreSQL-binærene finnes via PG_BIN eller standard installasjonsmappe.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name)

function findBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN
  const candidates = process.platform === 'win32'
    ? ['18', '17', '16', '15'].map((v) => `C:/Program Files/PostgreSQL/${v}/bin`)
    : ['/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  return candidates.find((d) => existsSync(path.join(d, exe('initdb'))))
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) throw r.error
  return r.status ?? 1
}

function runVitest(url) {
  const vitest = path.resolve('node_modules/vitest/vitest.mjs')
  return run(process.execPath, [vitest, 'run', '--config', 'vitest.pg.config.ts'], { env: { ...process.env, PG_TEST_URL: url } })
}

if (process.env.PG_TEST_URL) {
  process.exit(runVitest(process.env.PG_TEST_URL))
}

const bin = findBin()
if (!bin) {
  console.error('Fant ikke PostgreSQL (initdb). Sett PG_BIN eller PG_TEST_URL.')
  process.exit(1)
}

const port = process.env.PG_TEST_PORT ?? '54329'
const dir = mkdtempSync(path.join(os.tmpdir(), 'bakekalkulator-pg-'))
const data = path.join(dir, 'data')
let status = 1
try {
  if (run(path.join(bin, exe('initdb')), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale'], { stdio: 'ignore' }) !== 0) {
    throw new Error('initdb feilet')
  }
  const started = run(path.join(bin, exe('pg_ctl')), [
    '-D', data, '-l', path.join(dir, 'postgres.log'), '-w',
    '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=60 -c deadlock_timeout=200ms`,
    'start',
  ], { stdio: 'ignore' })
  if (started !== 0) throw new Error(`pg_ctl start feilet (port ${port} i bruk?) – se ${path.join(dir, 'postgres.log')}`)
  console.log(`Midlertidig PostgreSQL startet på 127.0.0.1:${port}`)
  status = runVitest(`postgresql://postgres@127.0.0.1:${port}/postgres`)
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
} finally {
  run(path.join(bin, exe('pg_ctl')), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore' })
  rmSync(dir, { recursive: true, force: true })
  console.log('Midlertidig PostgreSQL stoppet og slettet.')
}
process.exit(status)
