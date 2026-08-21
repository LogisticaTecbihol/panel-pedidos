-- Agregar columna Bodega a InventarioFisico
ALTER TABLE "InventarioFisico"
  ADD COLUMN "Bodega" text DEFAULT 'Productos Buenos';
