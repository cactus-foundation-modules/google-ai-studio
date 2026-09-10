-- Reference pictures that did not come from a url.
--
-- The original design had one kind of reference: a photograph already in the
-- media library, named by its url and fetched afresh for every picture the job
-- makes. A view captured from a 3D model has no url and never will - it is a
-- still of something the browser drew, and a view nobody chose to keep is not a
-- file the site owner should have to tidy out of their library afterwards.
--
-- So the bytes are kept with the job, and go when the job does. A job is scratch
-- and swept at a day old; these ride the same cascade.

CREATE TABLE IF NOT EXISTS "gas_job_source_images" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "job_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    -- What the owner called this view ("3D view - Oak / Large 2"), kept so a
    -- picture can still be explained a day later alongside the prompt.
    "label" TEXT NOT NULL DEFAULT '',
    -- The order they were handed to Google in, which is the order they were
    -- created in. Google reads references in order and the last word carries
    -- weight, so this is not decoration.
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gas_job_source_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gas_job_source_images_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "gas_jobs"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "gas_job_source_images_job_id_idx" ON "gas_job_source_images" ("job_id", "position");
