import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'

/**
 * Testoppsett som kjører de ekte migrasjonene i en Postgres i minnet (PGlite).
 * Supabase-spesifikke deler (auth.users, auth.uid(), rollene anon/authenticated/
 * service_role og standardrettighetene) simuleres her – kun for testing.
 * Ingenting kjøres mot den eksterne databasen.
 */
const migrations = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const SUPABASE_STUB = `
create schema auth;
create schema extensions;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now()
);
-- Som i Supabase: leser sub fra request.jwt.claim.sub eller request.jwt.claims
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

export interface TestDb {
  db: PGlite
  signUp: (email: string, meta?: Record<string, unknown>) => Promise<string>
  as: <T = Record<string, unknown>>(uid: string, sql: string, params?: unknown[]) => Promise<T[]>
  /** Som `as`, men med egne JWT-claims (f.eks. gammel innlogging i amr). */
  asWithClaims: <T = Record<string, unknown>>(uid: string, claims: Record<string, unknown>, sql: string, params?: unknown[]) => Promise<T[]>
  asAnon: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>
  su: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>
}

export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create({ extensions: { btree_gist } })
  await db.exec(SUPABASE_STUB)
  for (const name of Object.keys(migrations).sort()) {
    try {
      await db.exec(migrations[name])
    } catch (e) {
      throw new Error(`Migrasjon feilet: ${name}: ${(e as Error).message}`, { cause: e })
    }
  }

  const run = async <T>(role: string | null, uid: string | null, sql: string, params?: unknown[], extraClaims?: Record<string, unknown>): Promise<T[]> => {
    // Standard: fersk passordinnlogging (amr), slik Supabase Auth signerer i JWT-en
    const claims = uid
      ? { sub: uid, role: role ?? 'authenticated', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }], ...extraClaims }
      : {}
    if (role) await db.exec(`set role ${role}`)
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid ?? '', uid ? JSON.stringify(claims) : ''])
    try {
      return (await db.query<T>(sql, params)).rows
    } finally {
      await db.exec('reset role')
      await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`)
    }
  }

  return {
    db,
    signUp: async (email, meta = {}) => {
      const r = await db.query<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, meta])
      return r.rows[0].id
    },
    as: (uid, sql, params) => run(`authenticated`, uid, sql, params),
    asWithClaims: (uid, claims, sql, params) => run('authenticated', uid, sql, params, claims),
    asAnon: (sql, params) => run('anon', null, sql, params),
    su: (sql, params) => run(null, null, sql, params),
  }
}
