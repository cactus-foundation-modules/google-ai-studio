-- Google AI Studio: one API key, and whatever the site wants to make with it.
--
-- Three tables, and only the first of them is meant to last. A generation job
-- and its candidate pictures are scratch: they exist between "make me four of
-- these" and the owner deciding which (if any) are worth keeping, and are swept
-- once they are a day old. Only an accepted picture graduates into the media
-- library, which is the one place on this site pictures are supposed to live.

-- ---------------------------------------------------------------------------
-- Settings (singleton)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "gas_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    -- AES-GCM ciphertext from lib/crypto/secrets. Null while the owner has not
    -- pasted a key in, or while the key is supplied by an env var instead.
    "api_key_encrypted" TEXT,
    -- Which Google model makes the pictures. A plain string rather than a CHECK:
    -- Google names a new image model every few months and a site should not have
    -- to wait for a module release to type it in.
    "image_model" TEXT NOT NULL DEFAULT 'gemini-3.1-flash-image',
    -- How many pictures a job asks for when nobody says otherwise. Each one is a
    -- separate call to Google and a separate charge, hence the modest ceiling.
    "default_image_count" INTEGER NOT NULL DEFAULT 3,
    -- The house style, applied to every product photo job. The per-job prompt is
    -- added to it, so this is where "always a plain white background" lives.
    "product_photo_prompt" TEXT NOT NULL DEFAULT '',
    -- Shape and size of what comes back. Google's own vocabulary, verbatim, so
    -- the settings screen and the API cannot drift apart.
    "aspect_ratio" TEXT NOT NULL DEFAULT '1:1',
    "image_size" TEXT NOT NULL DEFAULT '2K',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gas_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gas_settings_singleton_check" CHECK ("id" = 'singleton'),
    CONSTRAINT "gas_settings_default_image_count_check" CHECK ("default_image_count" BETWEEN 1 AND 8)
);

INSERT INTO "gas_settings" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- One "make me some pictures" job
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "gas_jobs" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    -- What the job was about. For product photos this is a shp_products id, but
    -- there is deliberately no foreign key to it: this module works on a site
    -- with no shop at all, and a table it does not own may simply not be there.
    -- The sweep below is what stops orphans piling up.
    "subject" TEXT NOT NULL DEFAULT 'shop-product',
    "subject_id" TEXT,
    -- Exactly what was sent, kept so a picture can be explained a week later.
    "prompt" TEXT NOT NULL,
    -- The media urls handed to Google as reference pictures.
    "source_urls" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "model" TEXT NOT NULL,
    "aspect_ratio" TEXT NOT NULL,
    "image_size" TEXT NOT NULL,
    "requested" INTEGER NOT NULL DEFAULT 1,
    -- core User id. No FK for the same reason as subject_id: a deleted admin
    -- must not take a job's pictures with them mid-review.
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gas_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "gas_jobs_subject_idx" ON "gas_jobs" ("subject", "subject_id");
CREATE INDEX IF NOT EXISTS "gas_jobs_created_at_idx" ON "gas_jobs" ("created_at");

-- ---------------------------------------------------------------------------
-- The candidates a job produced
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "gas_job_images" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "job_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    -- The picture itself. It lives here rather than in the media library
    -- because most of these are rejected: an owner asking for four and keeping
    -- one should not have to go and tidy up the other three.
    "bytes" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    -- Set once the picture has been accepted and copied into the media library.
    -- Kept (rather than the row being deleted) so a second press of Add cannot
    -- quietly make a second copy of the same picture.
    "media_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gas_job_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gas_job_images_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "gas_jobs"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "gas_job_images_job_id_idx" ON "gas_job_images" ("job_id");
