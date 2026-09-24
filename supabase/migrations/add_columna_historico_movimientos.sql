-- Columna "Historico": marca registros de carga retroactiva (anteriores al
-- 2026-07-01, fecha del Saldo Inicial de todas las empresas) en los 7
-- módulos de movimiento, para que alimenten las tendencias del Dashboard
-- (que lee cada tabla completa y filtra por fecha en memoria) SIN afectar
-- las existencias actuales ni el Kardex (que sí deben ignorarlos por
-- completo: ver js/kardex.js:buildMovimientos/buildNCMovimientos y
-- js/existencias.js:buildKxMovimientos/_computeComprometido_Inv/
-- _computeMovimientos_Inv).
--
-- Solo el rol 'admin' puede insertar Historico = true (reforzado también a
-- nivel de RLS, no solo en la UI). El flag es inmutable desde la UI una vez
-- creado el registro: los handlers de edición en js/shared.js no deben
-- aceptar ni sobreescribir esta columna.

alter table public."Pedidos"           add column if not exists "Historico" boolean not null default false;
alter table public."Ingresos"          add column if not exists "Historico" boolean not null default false;
alter table public."Reenvases"         add column if not exists "Historico" boolean not null default false;
alter table public."KardexNC"          add column if not exists "Historico" boolean not null default false;
alter table public."CambiosMercancia"  add column if not exists "Historico" boolean not null default false;
alter table public."Devoluciones"      add column if not exists "Historico" boolean not null default false;
alter table public."SolicitudMuestras" add column if not exists "Historico" boolean not null default false;

-- Índices parciales: la inmensa mayoría de las filas serán Historico=false;
-- solo indexamos las históricas para que el filtro "Mostrar históricos" de
-- cada listado sea barato.
create index if not exists idx_pedidos_historico           on public."Pedidos"           ("Historico") where "Historico";
create index if not exists idx_ingresos_historico          on public."Ingresos"          ("Historico") where "Historico";
create index if not exists idx_reenvases_historico         on public."Reenvases"         ("Historico") where "Historico";
create index if not exists idx_kardexnc_historico          on public."KardexNC"          ("Historico") where "Historico";
create index if not exists idx_cambiosmercancia_historico  on public."CambiosMercancia"  ("Historico") where "Historico";
create index if not exists idx_devoluciones_historico      on public."Devoluciones"      ("Historico") where "Historico";
create index if not exists idx_solicitudmuestras_historico on public."SolicitudMuestras" ("Historico") where "Historico";

-- Endurece las políticas de INSERT: si el registro trae Historico = true,
-- exige rol 'admin' (además de los requisitos que ya tenía cada política).
-- El texto base de cada política se tomó de pg_policies en vivo antes de
-- reemplazarla, para no alterar accidentalmente el resto de la condición.

drop policy if exists "CambiosMercancia_insert" on public."CambiosMercancia";
create policy "CambiosMercancia_insert" on public."CambiosMercancia" for insert
  with check (
    (get_user_role() = any (array['admin','editor','contabilidad','gerente_iaso','remisionador']))
    and user_has_company("Empresa")
    and ("Historico" is not true or get_user_role() = 'admin')
  );

drop policy if exists "Devoluciones_insert" on public."Devoluciones";
create policy "Devoluciones_insert" on public."Devoluciones" for insert
  with check (
    (get_user_role() = any (array['admin','editor','contabilidad','gerente_iaso','remisionador']))
    and user_has_company("Empresa")
    and ("Historico" is not true or get_user_role() = 'admin')
  );

drop policy if exists "KardexNC_insert" on public."KardexNC";
create policy "KardexNC_insert" on public."KardexNC" for insert
  with check (
    (get_user_role() = any (array['admin','editor','contabilidad','gerente_iaso','remisionador']))
    and user_has_company("Empresa")
    and ("Historico" is not true or get_user_role() = 'admin')
  );

drop policy if exists "Reenvases_insert" on public."Reenvases";
create policy "Reenvases_insert" on public."Reenvases" for insert
  with check (
    (get_user_role() = any (array['admin','editor','contabilidad','gerente_iaso','remisionador']))
    and user_has_company("Empresa")
    and ("Historico" is not true or get_user_role() = 'admin')
  );

drop policy if exists "Ingresos_insert" on public."Ingresos";
create policy "Ingresos_insert" on public."Ingresos" for insert
  with check (
    (get_user_role() = any (array['admin','editor','contabilidad','gerente_iaso','remisionador']))
    and (user_has_company("Empresa_Origen") or user_has_company("Empresa_Destino"))
    and ("Historico" is not true or get_user_role() = 'admin')
  );

drop policy if exists "Pedidos_insert" on public."Pedidos";
create policy "Pedidos_insert" on public."Pedidos" for insert
  with check (
    (user_has_company("Nombre_Empresa")
     and ((get_user_role() = any (array['admin','editor','contabilidad','gerente_iaso','remisionador']))
          or (get_user_role() = 'comercial' and comercial_id = (select auth.uid()))))
    and ("Historico" is not true or get_user_role() = 'admin')
  );

drop policy if exists "SolicitudMuestras_insert" on public."SolicitudMuestras";
create policy "SolicitudMuestras_insert" on public."SolicitudMuestras" for insert
  with check (
    (user_has_company("Empresa")
     and ((get_user_role() = any (array['admin','editor','contabilidad','gerente_iaso','remisionador']))
          or (get_user_role() = 'comercial' and responsable_id = auth.uid())))
    and ("Historico" is not true or get_user_role() = 'admin')
  );

notify pgrst, 'reload schema';
