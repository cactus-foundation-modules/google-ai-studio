import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

// A job is scratch. It exists between "make me four of these" and the owner
// deciding which are worth keeping, and is swept once it is a day old - so the
// pictures nobody wanted never become somebody's problem later.

const RETENTION_HOURS = 24

export type JobRow = {
  id: string
  subject: string
  subject_id: string | null
  prompt: string
  source_urls: unknown
  model: string
  aspect_ratio: string
  image_size: string
  requested: number
  created_by_id: string | null
}

export type CandidateSummary = {
  id: string
  mimeType: string
  sizeBytes: number
  /** Set once the picture has been copied into the media library. */
  mediaId: string | null
}

export type CandidateBytes = {
  id: string
  jobId: string
  mimeType: string
  bytes: Buffer
  mediaId: string | null
}

export async function createJob(input: {
  subject: string
  subjectId: string | null
  prompt: string
  sourceUrls: string[]
  model: string
  aspectRatio: string
  imageSize: string
  requested: number
  createdById: string | null
}): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "gas_jobs"
      ("subject", "subject_id", "prompt", "source_urls", "model", "aspect_ratio", "image_size", "requested", "created_by_id")
    VALUES
      (${input.subject}, ${input.subjectId}, ${input.prompt}, ${JSON.stringify(input.sourceUrls)}::jsonb,
       ${input.model}, ${input.aspectRatio}, ${input.imageSize}, ${input.requested}, ${input.createdById})
    RETURNING "id"
  `
  const id = rows[0]?.id
  if (!id) throw new Error('Could not start that job.')
  return id
}

/** A reference picture stored with the job rather than named by a url. */
export type JobSourceImage = { mimeType: string, data: string, label: string }

/**
 * Keep the reference pictures a job was handed as bytes.
 *
 * Written in one statement rather than one per picture: half a dozen views is
 * an ordinary ask, and six round trips to store what arrived in one request is
 * six chances for the job to end up with a partial set of references.
 */
export async function addJobSourceImages(jobId: string, images: JobSourceImage[]): Promise<void> {
  if (images.length === 0) return
  // Same decode() treatment as a candidate's bytes, and for the same reason:
  // the base64 says what is meant in the query itself rather than trusting an
  // untyped Buffer parameter to survive the round trip. See addJobImage.
  const values = Prisma.join(images.map((image, position) => Prisma.sql`(
    ${jobId}, ${image.mimeType}, decode(${image.data}, 'base64'),
    ${Buffer.byteLength(image.data, 'base64')}, ${image.label}, ${position}
  )`))
  await prisma.$executeRaw`
    INSERT INTO "gas_job_source_images" ("job_id", "mime_type", "bytes", "size_bytes", "label", "position")
    VALUES ${values}
  `
}

/** A job's stored reference pictures, in the order they were handed over. */
export async function listJobSourceImages(jobId: string): Promise<JobSourceImage[]> {
  // Read back as base64 for the same reason it was written that way: a bytea
  // column comes out of a raw query as a Uint8Array, not always a Buffer.
  const rows = await prisma.$queryRaw<{ mime_type: string, b64: string, label: string }[]>`
    SELECT "mime_type", encode("bytes", 'base64') AS "b64", "label"
      FROM "gas_job_source_images"
     WHERE "job_id" = ${jobId}
     ORDER BY "position" ASC, "created_at" ASC
  `
  return rows.map((row) => ({ mimeType: row.mime_type, data: row.b64, label: row.label }))
}

export async function getJob(id: string): Promise<JobRow | null> {
  const rows = await prisma.$queryRaw<JobRow[]>`
    SELECT "id", "subject", "subject_id", "prompt", "source_urls", "model",
           "aspect_ratio", "image_size", "requested", "created_by_id"
      FROM "gas_jobs" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0] ?? null
}

export async function addJobImage(jobId: string, mimeType: string, bytes: Buffer): Promise<CandidateSummary> {
  // The bytes travel as base64 and are decoded by Postgres. Handing Prisma a
  // Buffer for an untyped parameter is the sort of thing that works until the
  // day it does not; decode() says what is meant in the query itself.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "gas_job_images" ("job_id", "mime_type", "bytes", "size_bytes")
    VALUES (${jobId}, ${mimeType}, decode(${bytes.toString('base64')}, 'base64'), ${bytes.length})
    RETURNING "id"
  `
  const id = rows[0]?.id
  if (!id) throw new Error('Could not keep that picture.')
  return { id, mimeType, sizeBytes: bytes.length, mediaId: null }
}

export async function listJobImages(jobId: string): Promise<CandidateSummary[]> {
  const rows = await prisma.$queryRaw<{ id: string, mime_type: string, size_bytes: number, media_id: string | null }[]>`
    SELECT "id", "mime_type", "size_bytes", "media_id"
      FROM "gas_job_images" WHERE "job_id" = ${jobId} ORDER BY "created_at" ASC
  `
  return rows.map((r) => ({ id: r.id, mimeType: r.mime_type, sizeBytes: r.size_bytes, mediaId: r.media_id }))
}

export async function getCandidate(id: string): Promise<CandidateBytes | null> {
  // Read back as base64 for the same reason it was written that way: a bytea
  // column comes out of a raw query as a Uint8Array, not always a Buffer, and
  // code that assumes otherwise corrupts the picture without saying so.
  const rows = await prisma.$queryRaw<{ id: string, job_id: string, mime_type: string, b64: string, media_id: string | null }[]>`
    SELECT "id", "job_id", "mime_type", encode("bytes", 'base64') AS "b64", "media_id"
      FROM "gas_job_images" WHERE "id" = ${id} LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    jobId: row.job_id,
    mimeType: row.mime_type,
    bytes: Buffer.from(row.b64, 'base64'),
    mediaId: row.media_id,
  }
}

export async function markCandidateImported(id: string, mediaId: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "gas_job_images" SET "media_id" = ${mediaId} WHERE "id" = ${id}`
}

export async function deleteJob(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "gas_jobs" WHERE "id" = ${id}`
}

/**
 * Drop anything older than a day. Called from the generate route rather than a
 * cron job: this module has no other reason to run on a schedule, and a site
 * that has stopped making pictures has nothing left to sweep.
 */
export async function sweepOldJobs(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "gas_jobs"
     WHERE "created_at" < NOW() - (${RETENTION_HOURS} || ' hours')::interval
  `
}
