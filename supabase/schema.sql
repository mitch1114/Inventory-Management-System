-- =============================================================================
-- ACC Crappie Stix Inventory Management System -- Supabase Schema
-- =============================================================================
-- Run this in your Supabase project's SQL Editor (Dashboard > SQL Editor > New Query)
-- This creates the table and security policies needed for the app.
-- =============================================================================

-- Single-document store for the entire app state.
-- This keeps the migration simple while giving us shared, real-time data.
-- Can be migrated to fully relational tables later if needed.
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- Enable Row Level Security
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

-- Allow anyone with the anon key to read and write.
-- This is appropriate for a small internal business tool.
-- For tighter security later, add Supabase Auth and restrict to authenticated users.
CREATE POLICY "Allow public read"  ON app_state FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON app_state FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON app_state FOR UPDATE USING (true);

-- Enable realtime so changes push to all connected browsers instantly
ALTER PUBLICATION supabase_realtime ADD TABLE app_state;

-- Insert an empty initial row (the app will populate it on first save)
INSERT INTO app_state (id, data) VALUES ('main', '{}')
ON CONFLICT (id) DO NOTHING;
