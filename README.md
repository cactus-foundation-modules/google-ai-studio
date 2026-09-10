<p align="center">
  <img src="module-art.webp" alt="Google AI Studio" width="640" />
</p>

# Google AI Studio

Brings Google AI Studio to Cactus. Paste in one API key and the site can make pictures for you and
draft your replies.

The first thing it does with that key: **AI photo creation** on a shop product's **Images** tab.
Pick the photographs you already have - the product's own, its variations', and any picture
attributes on it - say what you would like, and choose from what comes back. Nothing is added to the
product, or even to your media library, until you say so.

With the **3D views** module installed there is a **From 3D models** button alongside them. It opens
the product's own 3D model, with a dropdown per option so you can put it in the colour and size you
want, and every press of **Create view** adds the current angle to the pictures going to Google.
Turn the model, press it again, and the AI is working from four real views of the real product
instead of guessing at three of them.

The second thing it does with that key: **Suggest reply**. Wherever this site has a reply box - the
Unified Inbox, the contact form's own inbox - there is a button under the writing that reads the
conversation and offers three drafts. Click one to try it in the box, tick to keep it, cross to put
back what you were writing. It is published through core's `core.reply-suggestions` seam, so this
module never learns which module the conversation came from and the module holding it never learns
which model answered.

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
| House style for replies | Added to the front of every suggested reply - how the business SOUNDS. Deliberately about manner rather than content: a house style that starts answering questions gets those answers given confidently on conversations where they are not true. |
| Writing model | Which Google model writes the drafts. A different one from the picture model; a plain text box for the same reason. |

## How the picture-making works

- One call to Google makes one picture, so a job asking for four makes four calls. The browser makes
  them one at a time and shows each picture as it lands, which is also what keeps every request
  inside the sixty seconds a module route gets.
- **A rate limit waits itself out.** Google answering 429 is not a failure - the key is fine, the
  request is fine, and only the moment is wrong. The browser honours Google's own `Retry-After` where
  it sent one, otherwise backs off 15s, 25s, 40s, 60s with a little jitter (so four pictures failing
  together do not all come back together and get refused together), and keeps asking until it has a
  picture. It shows a countdown and a **Stop** button throughout, and gives up the moment the page
  goes - it is tied to an `AbortController` that unmount, `pagehide`, **Stop** and **Discard** all
  end. Nothing is retried on the server: a module route has sixty seconds and a quota window has
  rather more than that.
- Candidates are kept in this module's own tables, not in the media library, because most of them are
  rejected. They are swept once they are a day old.
- Accepting a picture uploads it into the media library like any other upload - in the same folder as
  the product's own photographs - and hands it to the product editor's gallery as an unsaved edit.
  The editor's own **Save** button is what commits it.
- Nothing is stored on Google's side: the API is called with `store: false`.

## How the reply-suggesting works

- Published through core's `core.reply-suggestions` extension point (`lib/reply-suggestions.ts`,
  `serverOnly`). Core hands over the conversation as plain words and gets drafts back; **neither end
  learns the other**. This module never knows whether the messages came from a mailbox, a contact
  form or a chat widget, and the module holding them never knows which model answered.
- `isConfigured()` reads the settings row and nothing else. It has to be cheap: a reply box asks it
  while it is being drawn, to decide whether to draw the button at all.
- One call to `generateContent`, pinned to a JSON array of strings with a response schema
  (`lib/gemini-text.ts`). A model asked politely for "three replies, numbered" will one day answer
  with two, or four, or a preamble - a schema is what stops that becoming a parsing problem.
- The prompt is built in `lib/reply-prompt.ts`, which is pure and tested: house style, then the
  transcript between fences, then the instruction. The transcript is DATA and the prompt says so
  **before** the fences as well as after, and anything in a message that looks like the closing fence
  is defused on the way in - a stranger typed those words.
- A message carries a `role` of `them`, `us` or `note` rather than a direction. A note is a colleague
  talking to a colleague: it is context worth having, and is marked as something the customer has
  never seen so it is not quoted back at them.
- Google's own wording for a failure is carried across rather than flattened - "check the key", "we
  do not know that model" - along with its status, so a rate limit still reads as one at the far end.

## What it depends on

Nothing. This module declares no `requiresModules` and imports nothing from another module's code,
so it installs on a site with no shop at all. The shop half of it appears when a shop is there,
found by looking for the tables rather than by naming the module:

| Table present | What appears |
|---------------|--------------|
| `shp_product_media` | The AI photo section, and the product's own pictures as sources |
| `svr_variants` | Each variation's lead photograph as a source |
| `pat_attribute_values` | Picture attributes on the product or its variations as sources |

Extra sources of reference pictures are contributed by other modules through the
`google-ai-studio.reference-image-sources` extension point, which this module hosts. A contributor
renders whatever picker it likes and hands each finished picture over by dispatching a cancelable
`cactus-ai-reference-image` window event carrying `{ dataUrl, label }`; this panel takes it by
cancelling the event, so a contributor can tell whether anything was listening. Nothing is imported
in either direction, and the two halves can be released in either order - an unrecognised
contributor simply never appears, and a contributor with nobody listening says so.

`product-3d-views-for-shop` **0.1.100** is the first version to contribute one.

The reply-suggesting half needs no module at all beyond something with a reply box on it.
`unified-inbox` and `contact-form` each consume the seam from a route of their own; a site with
neither simply has nowhere for the button to appear.

Handing a finished picture to the product editor needs Shop **0.1.412** or newer (the release that
added the gallery-add seam). On an older shop the picture still lands in the media library, and the
panel says so rather than pretending otherwise.

## Tables

| Table | Holds |
|-------|-------|
| `gas_settings` | The singleton settings row, key encrypted |
| `gas_jobs` | One "make me some pictures" request - scratch, swept after a day |
| `gas_job_images` | The candidates a job produced, until they are accepted or thrown away |
| `gas_job_source_images` | Reference pictures with no url of their own - a captured 3D view - kept only for the life of the job |
