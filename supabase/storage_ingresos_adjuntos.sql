-- Bucket de almacenamiento para adjuntos de ingresos
INSERT INTO storage.buckets (id, name, public)
VALUES ('ingresos-adjuntos', 'ingresos-adjuntos', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de acceso
CREATE POLICY "ing_adjuntos_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'ingresos-adjuntos');

CREATE POLICY "ing_adjuntos_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'ingresos-adjuntos'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "ing_adjuntos_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'ingresos-adjuntos'
    AND auth.role() = 'authenticated'
  );
