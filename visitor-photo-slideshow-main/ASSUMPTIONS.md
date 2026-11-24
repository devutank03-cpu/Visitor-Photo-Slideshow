# Design Decisions & Engineering Assumptions

This document outlines the architectural trade-offs, design gap resolutions, and engineering decisions made during the implementation of the **Visitor Photo Slideshow** application.

---

## 1. Returning Visitor Identification: Normalized Contact vs. Name or Accounts

### Design Gap
The prompt specified that returning visitors must be recognized so their status is displayed on the TV screen and their prior photos are re-queued. However, in an in-person gallery setting, requiring users to register full password-protected accounts or verify one-time email OTP links creates friction that discourages participation. Conversely, identifying visitors solely by their first/last name causes severe collision issues (e.g., multiple unrelated visitors named "Alex Smith" or "John Doe").

### Chosen Solution
We introduced a **normalized unique contact field** (`contact`: phone or email) combined with a display name (`name`):
- **Email Normalization**: Leading and trailing whitespaces are stripped, and the entire string is converted to lowercase (`"  Alice@Example.COM "` $\rightarrow$ `"alice@example.com"`).
- **Phone Normalization**: All formatting symbols, country code separators, spaces, and dashes are stripped to retain only digits (`"+1 (555) 019-2834"` $\rightarrow$ `"15550192834"`).
- **Visitor Upsert**: When a visitor checks in, we execute a Prisma `upsert` keyed on `contact`. If they previously checked in, their display name is updated to the latest submission, but their account identity and existing photo history are preserved.

### Alternatives Considered & Rejected
1. **Name-Only Lookup**: Rejected because common names inevitably collide, accidentally grouping photos of different individuals under one identity.
2. **Full Auth (NextAuth / Auth0 / Supabase)**: Rejected as overly burdensome for a 30-second mobile check-in flow at an art exhibit or museum kiosk.
3. **Browser Cookies / LocalStorage**: Rejected because visitors may check in from different devices (e.g., mobile phone on arrival, kiosk tablet later) and cookies are frequently blocked or wiped in incognito browsing.

---

## 2. Slideshow Queue & Repeat Playback: Hybrid Priority Loop

### Design Gap
If a slideshow strictly presents only unplayed (`"QUEUED"`) photos, the TV display will go blank the moment all visitors' photos have been shown once. Conversely, if all photos are shuffled randomly, recently submitted photos from newly arrived visitors might get buried behind hundreds of previously shown photos.

### Chosen Solution
We implemented a **two-tier hybrid queue**:
1. **High-Priority FIFO Queue**: Photos with `status: "QUEUED"` are always selected first, ordered chronologically (`createdAt asc`). This ensures visitors who just uploaded photos see them appear on screen promptly in the order they arrived.
2. **Continuous Backfill Loop**: If the number of unplayed photos is smaller than the requested `limit` (default 20), the remaining slots are backfilled with already presented photos (`status: "PLAYED"` ordered by `createdAt desc`).
3. **Returning Visitor Re-Queueing**: When a returning visitor checks in, their older photos are reset from `"PLAYED"` back to `"QUEUED"`. This brings their entire portfolio back into active rotation alongside their newly uploaded media.
4. **Playback Duration & Ack**: Each slide displays for exactly 8 seconds (`slideDurationSeconds: 8`) with a synchronized countdown bar on the TV display. Upon completion, `/api/slideshow/ack` marks the photo as `"PLAYED"` and increments its `playCount`.

### Alternatives Considered & Rejected
- **Pure FIFO Queue with Blank Screen**: Screen goes idle once the queue is drained.
- **Pure Random Shuffle**: Destroys the immediate feedback loop for new visitors waiting by the display.

---

## 3. Privacy & Consent Control Model

### Design Gap
Displaying visitor photographs in a public physical space introduces privacy and consent considerations. Visitors must explicitly opt in and retain the right to delete their photos at any time.

### Chosen Solution
1. **Mandatory Opt-In**: The check-in form requires checking an explicit consent checkbox (*"I consent to displaying my photos publicly on the gallery slideshow screen"*). The submit button remains disabled until checked, and the backend strictly rejects any payload where `consent !== "true"`.
2. **Self-Service Privacy Management (`/api/visitor/photos`)**:
   - Visitors can navigate to the **"Manage / Delete My Photos"** tab, enter their normalized contact identifier, and instantly view all photos they have uploaded.
   - **Individual Removal**: Visitors can delete specific photos.
   - **Bulk Purge ("Delete All My Photos")**: Visitors can purge their entire presence from the exhibition with one click.
   - **Disk & Database Sync**: Deletions atomically remove both the Prisma SQLite records and the physical image files on disk.

### Alternatives Considered & Rejected
- **Admin-Only Deletion**: Requires staffing an administrator to handle manual visitor deletion requests, creating delays and privacy friction.
- **Auto-expiring Photos (TTL)**: While effective for temporary events, it prevents guests who revisit the exhibition days later from having their photos re-queued.

---

## 4. Upload Limits & Storage Strategy

### Design Gap
The system needed a storage and validation layer that prevents server resource exhaustion, guards against malicious files, and guarantees zero setup friction for evaluators.

### Chosen Solution
- **File Quantity**: Strictly limited to 1–3 photos per submission.
- **File Size**: Strictly capped at 5MB per image.
- **MIME Whitelist**: Strictly restricted to standard web image formats: `image/jpeg`, `image/png`, and `image/webp`.
- **Cloudinary Asset Storage with Local Fallback**:
  - Validated image buffers are streamed directly to Cloudinary (`folder: visitor-slideshow`).
  - Saved records store secure HTTPS Cloudinary CDN URLs (`https://res.cloudinary.com/...`).
  - Full self-service deletion triggers `cloudinary.uploader.destroy()` to ensure assets are purged from the cloud CDN.
  - If Cloudinary credentials are omitted in local development, it gracefully falls back to local disk storage in `public/uploads/` with UUID naming.
- **Serverless PostgreSQL (Neon)**:
  - SQLite databases do not persist across Vercel serverless function invocations; migrating Prisma to PostgreSQL enables true multi-tenant cloud persistence.

### Alternatives Considered & Rejected
- **Local SQLite / Local File Writes on Vercel**: Serverless execution environments have read-only/ephemeral filesystems; local SQLite files and local image writes are lost on cold starts.
- **Saving Base64 strings in Database**: Bloats database storage, degrades query performance, and lacks CDN caching benefits.

---

## 5. TV Display Access & Authentication

### Design Gap
Does the Smart TV / Museum display (`/display`) require an admin password or authentication token?

### Chosen Solution
For Assignment 1, `/display` is treated as a **public kiosk display route**:
- It requires no authentication cookies or login tokens so that it can be launched directly on a Smart TV web browser, projector, or kiosk screen by opening `/display`.
- A direct navigation button is provided on `/` to facilitate grading and multi-tab demonstration.
- **Production Roadmap**: In a production museum setup, a simple query token (e.g., `?kiosk_token=...`) or IP whitelist can be enforced in Next.js middleware to restrict the endpoint to authorized display hardware.
