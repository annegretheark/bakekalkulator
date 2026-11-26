// Oppsett for tester mot EKTE PostgreSQL (flere samtidige tilkoblinger).
// Lager en ny database per testfil, simulerer Supabase-delene (auth.users,
// auth.uid(), auth.jwt(), rollene) og kjører de uendrede migrasjonene.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const MIGRATIONS = path.resolve('supabase/migrations')

const ROLES = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;`

const STUB = `
create schema auth;
create schema if not exists extensions;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

export interface RealDb {
  url: string
  admin: pg.Client
  signUp: (email: string, meta?: Record<string, unknown>) => Promise<string>
  /** Ny tilkobling som opptrer som innlogget bruker (rollen authenticated + JWT-claims). */
  connectAs: (uid: string) => Promise<pg.Client>
  close: () => Promise<void>
}

export async function createRealDb(name: string): Promise<RealDb> {
  const base = process.env.PG_TEST_URL
  if (!base) throw new Error('PG_TEST_URL mangler – kjør `npm run test:pg`.')
  const dbName = `bake_${name}_${Date.now().toString(36)}`.toLowerCase()

  const root = new pg.Client({ connectionString: base })
  await root.connect()
  await root.query(ROLES)
  await root.query(`create database ${dbName}`)
  await root.end()

  const url = new URL(base)
  url.pathname = `/${dbName}`
  const admin = new pg.Client({ connectionString: url.toString() })
  await admin.connect()
  await admin.query(STUB)
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  }

  const clients: pg.Client[] = []
  return {
    url: url.toString(),
    admin,
    signUp: async (email, meta = {}) =>
      (await admin.query<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, meta])).rows[0].id,
    connectAs: async (uid) => {
      const c = new pg.Client({ connectionString: url.toString() })
      await c.connect()
      clients.push(c)
      const claims = { sub: uid, role: 'authenticated', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }
      await c.query(`set role authenticated`)
      await c.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid, JSON.stringify(claims)])
      return c
    },
    close: async () => {
      await Promise.all(clients.map((c) => c.end().catch(() => {})))
      await admin.end()
      const r = new pg.Client({ connectionString: base })
      await r.connect()
      await r.query(`drop database if exists ${dbName} with (force)`)
      await r.end()
    },
  }
}

/** Kjører fn i en transaksjon; returnerer { ok, error } i stedet for å kaste. */
export async function inTx<T>(c: pg.Client, fn: (c: pg.Client) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: Error & { code?: string } }> {
  await c.query('begin')
  try {
    const value = await fn(c)
    await c.query('commit')
    return { ok: true, value }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    return { ok: false, error: e as Error & { code?: string } }
  }
}
