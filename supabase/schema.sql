CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  event_url TEXT NOT NULL DEFAULT '',
  event_date DATE,
  published_at DATE,
  prefecture TEXT NOT NULL DEFAULT '',
  venue_or_area TEXT NOT NULL DEFAULT '',
  sport_type TEXT NOT NULL DEFAULT '',
  organizer TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_member_recruitment BOOLEAN NOT NULL DEFAULT FALSE,
  organizer_post_count INTEGER NOT NULL DEFAULT 0,
  is_high_volume_organizer BOOLEAN NOT NULL DEFAULT FALSE,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE events
  ALTER COLUMN organizer_post_count SET DEFAULT 0;

CREATE TABLE IF NOT EXISTS excluded_organizers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organizer_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_event_date ON events (event_date);
CREATE INDEX IF NOT EXISTS idx_events_prefecture ON events (prefecture);
CREATE INDEX IF NOT EXISTS idx_events_sport_type ON events (sport_type);
CREATE INDEX IF NOT EXISTS idx_events_organizer ON events (organizer);
CREATE INDEX IF NOT EXISTS idx_events_scraped_at ON events (scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_is_member ON events (is_member_recruitment);
CREATE INDEX IF NOT EXISTS idx_events_is_high_volume ON events (is_high_volume_organizer);
CREATE INDEX IF NOT EXISTS idx_excluded_organizers_name ON excluded_organizers (organizer_name);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON events;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE excluded_organizers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access" ON events;
CREATE POLICY "Public read access"
  ON events
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Authenticated full access" ON events;
CREATE POLICY "Authenticated full access"
  ON events
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public read access" ON excluded_organizers;
CREATE POLICY "Public read access"
  ON excluded_organizers
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Authenticated full access" ON excluded_organizers;
CREATE POLICY "Authenticated full access"
  ON excluded_organizers
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE events IS 'Moshicom crawler events.';
COMMENT ON COLUMN events.source_id IS 'Numeric event id extracted from the Moshicom URL.';
COMMENT ON COLUMN events.is_member_recruitment IS 'True when the event is judged to be a member recruitment post.';
COMMENT ON COLUMN events.organizer_post_count IS 'Per-crawl organizer posting count. Blank organizers stay 0.';
COMMENT ON COLUMN events.is_high_volume_organizer IS 'True when organizer_post_count reaches the configured threshold.';
COMMENT ON COLUMN events.scraped_at IS 'Timestamp when the crawl stored the event.';

COMMENT ON TABLE excluded_organizers IS 'Manual organizer exclusion list managed from the UI.';
COMMENT ON COLUMN excluded_organizers.organizer_name IS 'Organizer name to hide from the default event list.';
