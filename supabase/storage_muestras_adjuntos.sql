-- Bucket de almacenamiento para adjuntos de muestras
INSERT INTO storage.buckets (id, name, public)
VALUES ('muestras-adjuntos', 'muestras-adjuntos', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de acceso
CREATE POLICY "mu_adjuntos_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'muestras-adjuntos');

CREATE POLICY "mu_adjuntos_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'muestras-adjuntos'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "mu_adjuntos_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'muestras-adjuntos'
    AND auth.role() = 'authenticated'
  );
