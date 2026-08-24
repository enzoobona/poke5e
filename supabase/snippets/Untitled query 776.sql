-- Tabla
create table if not exists public.encounters (
	id uuid primary key default gen_random_uuid(),
	read_key text not null unique,
	write_key text not null unique,
	name text not null,
	data jsonb not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table public.encounters enable row level security;

-- Nadie accede a la tabla directamente, todo pasa por las funciones de abajo
create policy "no direct access" on public.encounters
	for all using (false);

-- Crear
create or replace function public.new_encounter(_name text, _data jsonb)
returns table(ret_id uuid, ret_read_key text, ret_write_key text)
language plpgsql
security definer
as $$
declare
	_read_key text := encode(gen_random_bytes(9), 'hex');
	_write_key text := encode(gen_random_bytes(9), 'hex');
	_id uuid;
begin
	insert into public.encounters (read_key, write_key, name, data)
	values (_read_key, _write_key, _name, _data)
	returning id into _id;

	return query select _id, _read_key, _write_key;
end;
$$;

-- Traer info liviana (para el listado lateral, sin traer todo el jsonb)
create or replace function public.get_encounter_info(_read_key text)
returns table(id uuid, name text, updated_at timestamptz)
language sql
security definer
as $$
	select id, name, updated_at from public.encounters where read_key = _read_key;
$$;

-- Traer el preset completo (al cargarlo en el editor)
create or replace function public.get_encounter(_read_key text)
returns table(id uuid, name text, data jsonb, updated_at timestamptz)
language sql
security definer
as $$
	select id, name, data, updated_at from public.encounters where read_key = _read_key;
$$;

-- Actualizar (sobreescribir nombre y/o contenido)
create or replace function public.update_encounter(_write_key text, _name text, _data jsonb)
returns integer
language plpgsql
security definer
as $$
declare
	_count integer;
begin
	update public.encounters
	set name = _name, data = _data, updated_at = now()
	where write_key = _write_key;

	get diagnostics _count = row_count;
	return _count;
end;
$$;

-- Eliminar
create or replace function public.delete_encounter(_write_key text)
returns integer
language plpgsql
security definer
as $$
declare
	_count integer;
begin
	delete from public.encounters where write_key = _write_key;
	get diagnostics _count = row_count;
	return _count;
end;
$$;

-- Permisos: dejá que el cliente anónimo/autenticado llame a las funciones
grant execute on function public.new_encounter(text, jsonb) to anon, authenticated;
grant execute on function public.get_encounter_info(text) to anon, authenticated;
grant execute on function public.get_encounter(text) to anon, authenticated;
grant execute on function public.update_encounter(text, text, jsonb) to anon, authenticated;
grant execute on function public.delete_encounter(text) to anon, authenticated;