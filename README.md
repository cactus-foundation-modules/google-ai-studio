<p align="center">
  <img src="module-art.webp" alt="Google AI Studio" width="640" />
</p>

# Google AI Studio

Brings Google AI Studio to Cactus. Paste in one API key and the site can make pictures for you.

The first thing it does with that key: **AI photo creation** on a shop product's **Images** tab.
Pick the photographs you already have - the product's own, its variations', and any picture
attributes on it - say what you would like, and choose from what comes back. Nothing is added to the
product, or even to your media library, until you say so.

## Installing

1. Install the module from **Modules** in the admin.
2. Go to **Settings → Google AI Studio** and paste in an API key from
   [aistudio.google.com](https://aistudio.google.com) (Get API key).
3. That is it. If the Shop module is installed, the AI photo section appears on every product's
   Images tab straight away.

The key can also be supplied as a `GOOGLE_AI_STUDIO_API_KEY` environment variable, which wins over
a key saved through the settings screen - handy for a pre-provisioned install. A key saved here is
stored encrypted with the site's own `ENCRYPTION_KEY`.

## Settings

| Setting | What it does |
|---------|--------------|
| API key | The Google AI Studio key. Stored encrypted, never shown again. |
| How many pictures a job makes | The number each job starts on. Changeable per job. |
| House style | Added to the front of every product photo job. Changeable per job. |
| Shape | Aspect ratio of new pictures (`1:1`, `4:5`, `16:9`, …). |
| Size | `512`, `1K`, `2K` or `4K`. Bigger costs more and takes longer. |
| Model | Which Google picture model to use. A plain text box on purpose: Google names a new one every few months and a site should not have to wait for a module release to try it. |

## How the picture-making works

- One call to Google makes one picture, so a job asking for four makes four calls. The browser makes
  them one at a time and shows each picture as it lands, which is also what keeps every request
  inside the sixty seconds a module route gets.
- Candidates are kept in this module's own tables, not in the media library, because most of them are
  rejected. They are swept once they are a day old.
- Accepting a picture uploads it into the media library like any other upload - in the same folder as
  the product's own photographs - and hands it to the product editor's gallery as an unsaved edit.
  The editor's own **Save** button is what commits it.
- Nothing is stored on Google's side: the API is called with `store: false`.

## What it depends on

Nothing. This module declares no `requiresModules` and imports nothing from another module's code,
so it installs on a site with no shop at all. The shop half of it appears when a shop is there,
found by looking for the tables rather than by naming the module:

| Table present | What appears |
|---------------|--------------|
| `shp_product_media` | The AI photo section, and the product's own pictures as sources |
| `svr_variants` | Each variation's lead photograph as a source |
| `pat_attribute_values` | Picture attributes on the product or its variations as sources |

Handing a finished picture to the product editor needs Shop **0.1.412** or newer (the release that
added the gallery-add seam). On an older shop the picture still lands in the media library, and the
panel says so rather than pretending otherwise.

## Tables

| Table | Holds |
|-------|-------|
| `gas_settings` | The singleton settings row, key encrypted |
| `gas_jobs` | One "make me some pictures" request - scratch, swept after a day |
| `gas_job_images` | The candidates a job produced, until they are accepted or thrown away |
