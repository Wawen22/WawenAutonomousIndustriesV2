-- ============================================================
-- WAI – Migration: meeting_notes (T125 Meeting Notes Automation)
-- Stores AI-summarized meeting notes with action items.
-- ============================================================

CREATE TABLE IF NOT EXISTS meeting_notes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text        NOT NULL,
  meeting_date      date        NOT NULL DEFAULT CURRENT_DATE,
  attendees         text[]      NOT NULL DEFAULT '{}',
  raw_notes         text        NOT NULL DEFAULT '',
  summary           text        NOT NULL DEFAULT '',
  action_items      jsonb       NOT NULL DEFAULT '[]',
  calendar_event_id text,
  contact_ids       uuid[]      NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting_date
  ON meeting_notes(meeting_date DESC);

-- Reuse set_updated_at() already defined in contacts migration
CREATE TRIGGER meeting_notes_updated_at
  BEFORE UPDATE ON meeting_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_meeting_notes"
  ON meeting_notes FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select_meeting_notes"
  ON meeting_notes FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_all_meeting_notes"
  ON meeting_notes FOR ALL TO service_role USING (true) WITH CHECK (true);
