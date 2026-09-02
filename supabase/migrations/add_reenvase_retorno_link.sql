-- Vínculo entre una salida a producción (Reenvases) y los ingresos de retorno
-- que se registran cuando el producto vuelve re-envasado de la planta.
--
--  • "Ingresos"."Reenvase_Ref"  = la "Remision" de la salida de la que proviene
--    el ingreso (FK lógica de texto, sin REFERENCES — igual que
--    "OrdenesCompra"."Ref_Pedido"). Vacío = ingreso normal, no ligado a producción.
--
--  • "Reenvases"."Estado"        = estado de cierre de la salida.
--       'Pendiente'  → sin ingresos de retorno todavía.
--       'Cerrada'    → el usuario dio por terminada la salida (acepta la merma).
--    El estado 'Parcial' (hay retornos pero no está cerrada) se DERIVA en el
--    cliente, no se guarda.
--
-- Existencias/Kardex no leen estas columnas: la salida sigue restando y cada
-- ingreso de retorno sigue sumando igual que antes. Son solo trazabilidad.

alter table public."Ingresos"
  add column if not exists "Reenvase_Ref" text not null default '';

alter table public."Reenvases"
  add column if not exists "Estado" text not null default 'Pendiente';

-- Normaliza filas previas (por si el default no aplicó a alguna).
update public."Reenvases"
  set "Estado" = 'Pendiente'
  where "Estado" is null or btrim("Estado") = '';

-- Restringe "Estado" a los valores válidos (idempotente: Postgres no soporta
-- ADD CONSTRAINT IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'Reenvases_Estado_check'
      and conrelid = 'public."Reenvases"'::regclass
  ) then
    alter table public."Reenvases"
      add constraint "Reenvases_Estado_check"
      check ("Estado" in ('Pendiente', 'Cerrada'));
  end if;
end $$;

-- Índice parcial: casi todos los ingresos van con "Reenvase_Ref" vacío; solo
-- indexamos los que sí están ligados a una salida a producción.
create index if not exists idx_ingresos_reenvase_ref
  on public."Ingresos" ("Reenvase_Ref")
  where "Reenvase_Ref" <> '';

notify pgrst, 'reload schema';
