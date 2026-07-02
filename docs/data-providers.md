# Data providers — Bright Data & Apify

Keyword-based collection. A keyword is submitted to each provider; every returned item is
normalised to only the fields the platform uses, then classified by Groq (sentiment + risk).

## Channel → provider map

| Channel   | Provider    | Mode         | Dataset / Actor id            | Notes |
|-----------|-------------|--------------|-------------------------------|-------|
| Reddit    | Bright Data | `brightdata` | `gd_lvz8ah06191smkebj4`       | posts by keyword |
| YouTube   | Bright Data | `brightdata` | `gd_lk56epmy2i5g7lzu0k`       | videos by keyword |
| Instagram | Apify       | `apify`      | `OQkrGAtl0AfRFKnJr`           | crawlerbros — posts by keyword |
| Telegram  | Apify       | `apify`      | `kCdMrRb7UiSRSFYeO`           | keyword mode |
| Quora     | Apify       | `apify`      | `BfPg8oJbuhM5M8h4d`           | crawlerbros — **needs session cookies** |
| LinkedIn  | Apify       | `apify`      | `buIWk2uOUzTmcLsuB`           | harvestapi — full post content, no cookies |

## Fields we keep (only what the platform uses)

For every item: **permalink** (`url`, click-to-open verification), **author handle** +
**author_url** (per-account counts), **text** (for Groq), **timestamp**, and light
**engagement** (likes / comments / views / upvotes). Everything else the actors return
(media URLs, music, location, thumbnails, etc.) is dropped in the per-platform normalisers
(`src/connectors/apify_connector.py`, `src/connectors/brightdata_connector.py`).

Per-platform source fields:
- **Instagram**: `username`, `profile_url`, `post_url`, `caption`, `hashtags`, `like_count`, `comment_count`, `pub_date`
- **Telegram**: `source_name`, `source_url`, `text`, `view_count`, `date`, `id`
- **Quora** (answers only): `authorName`, `authorUrl`, `questionUrl`, `questionTitle`, `text`, `upvotes`, `createdAt`
- **LinkedIn** (harvestapi): `commentary` (text), `linkedinUrl`, `author.name`/`publicIdentifier`, `author.linkedinUrl`, `postedAt.date`, `engagement.likes/comments/shares`
- **Reddit / YouTube (Bright Data)**: title/description, url, author/channel, date, likes/comments/views

## Credentials (.env)

- `BRIGHTDATA_API_KEY`, `APIFY_TOKEN` — set.
- `QUORA_SESSION_COOKIES` — **required**: the Quora actor returns 0 results without your
  Quora session cookie JSON. Paste it here (or into the actor's "Quora session cookies" input).
- `INSTAGRAM_SESSION_COOKIES` — optional; improves Instagram throughput.

Cookies are injected into the actor input via `apify.actors.<actor>.secret_inputs` in
`config.yaml` (maps an actor input field → an env var), so secrets never sit in the YAML.

## Note

**Quora needs the correct cookies** and bills per question/answer — keep `maxQuestions` /
`maxAnswersPerQuestion` modest (currently 20 / 5). The cookies MUST come from the
**quora.com** domain (e.g. `m-b`, `m-s`, `m-uid`), not third-party ad cookies (casalemedia,
pubmatic, doubleclick). Filter your browser's cookie list by Domain = `quora.com`.
