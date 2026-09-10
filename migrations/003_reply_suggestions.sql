-- Writing, not just pictures.
--
-- The module started out making product photographs, so every setting on it was
-- about photographs. Suggesting a reply to a customer is the same key doing a
-- different job: a model that writes rather than one that draws, and a house
-- style that says how this business SOUNDS rather than how its pictures look.
--
-- Two more columns on the singleton rather than a table of their own. A new
-- table would need a row seeding, a fallback for the install that has not seeded
-- it, and a second thing to keep in step with the settings screen - for two
-- strings that are read together with the six already here.
--
-- Idempotent, because an install already carrying the module picks this up on
-- its next update while 001 stays correct for a fresh one.

ALTER TABLE "gas_settings"
  -- Which Google model writes the words. Same reasoning as image_model: a plain
  -- string, because Google names a new one every few months and nobody should
  -- have to wait for a module release to type it in.
  ADD COLUMN IF NOT EXISTS "text_model" TEXT NOT NULL DEFAULT 'gemini-3.1-flash';

ALTER TABLE "gas_settings"
  -- The house style for replies: how this business talks to people. Added to
  -- every suggestion job the way product_photo_prompt is added to every picture
  -- job. Empty by default, and the module falls back to its own wording until
  -- somebody writes theirs - see lib/settings.ts.
  ADD COLUMN IF NOT EXISTS "reply_house_style" TEXT NOT NULL DEFAULT '';
