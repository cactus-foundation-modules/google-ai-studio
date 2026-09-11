-- Repairs a writing model that never existed.
--
-- 003 shipped `gemini-3.1-flash` as the column default, and v0.1.3 released it.
-- There is no such model: Google's 3.1 generation ships flash as
-- `gemini-3.1-flash-image` and `gemini-3.1-flash-lite`, and nothing in between,
-- so every install that ran 003 holds a name that answers 404.
--
-- 003 itself is left exactly as it was released. `scripts/run-module-migrations.mjs`
-- records what it has applied and never runs a file twice, so editing it would
-- mend nothing and would only make the released tree and this one disagree -
-- which `scripts/check-frozen-migrations.mjs` fails the build over, and rightly.
--
-- Two changes, both idempotent:
ALTER TABLE "gas_settings" ALTER COLUMN "text_model" SET DEFAULT 'gemini-3.5-flash';

-- ...and the row itself, ONLY where it still holds the broken default. A name
-- somebody has typed for themselves is their choice and is left exactly where it
-- is, even if it is also wrong - a migration quietly overwriting a setting is a
-- worse failure than the one it is mending, and the settings tab now offers
-- Google's own list to choose from.
UPDATE "gas_settings"
   SET "text_model" = 'gemini-3.5-flash',
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "text_model" = 'gemini-3.1-flash';
