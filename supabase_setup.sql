-- Funil Serasa: comprovantes PIX no projeto Sim-velani (SUPER-SIM-GENESYS).
-- Tabela e bucket isolados para nao misturar com os comprovantes do Super Sim.
-- Ja aplicado via MCP (migration comprovantes_sr_funil_serasa).

create table if not exists public.comprovantes_sr (
  id uuid primary key default gen_random_uuid(),
  txid text not null,
  url text not null,
  filename text,
  created_at timestamptz default now()
);

create index if not exists comprovantes_sr_txid_idx on public.comprovantes_sr (txid);

alter table public.comprovantes_sr enable row level security;

drop policy if exists comprovantes_sr_insert_anon on public.comprovantes_sr;
create policy comprovantes_sr_insert_anon
  on public.comprovantes_sr
  for insert
  to anon, authenticated
  with check (true);

-- INSERT only for anon: o PHP usa Prefer: return=minimal e nao precisa de SELECT.
grant insert on table public.comprovantes_sr to anon, authenticated;
grant select, insert on table public.comprovantes_sr to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprovantes-sr',
  'comprovantes-sr',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/json']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

-- Apenas INSERT: o backend envia o arquivo. Sem SELECT/UPDATE, ninguem baixa pela URL publica.
drop policy if exists comprovantes_sr_storage_insert on storage.objects;
create policy comprovantes_sr_storage_insert
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'comprovantes-sr');

drop policy if exists comprovantes_sr_storage_update on storage.objects;
drop policy if exists comprovantes_sr_storage_select on storage.objects;
