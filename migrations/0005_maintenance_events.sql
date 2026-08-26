CREATE TABLE maintenance_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL CHECK(event IN ('scheduled_refresh')),
  status TEXT NOT NULL CHECK(status IN ('complete','failed')),
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX maintenance_events_created_idx ON maintenance_events(created_at DESC);
