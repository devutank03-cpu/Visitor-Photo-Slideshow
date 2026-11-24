# AI Interaction & Engineering Log

This log documents the iterative prompt-driven engineering workflow used to design, build, debug, and test the **Visitor Photo Slideshow** application. It captures 7 key milestones, highlighting how specifications evolved, how edge cases were identified, and how errors were remediated.

---

## 1. Summary of 7 Development Interactions

### Interaction 1: Project Initialization & Full-Stack Scaffolding
- **Developer Prompt**:
  > "Initialize a Next.js 14+ (App Router) project with TypeScript and Tailwind CSS in the current directory. Setup Prisma with SQLite (`prisma/schema.prisma`) and create `.env.example` with `DATABASE_URL=\"file:./dev.db\"`."
- **AI Response Summary**:
  - Bootstrapped Next.js with App Router, TypeScript, and Tailwind CSS.
  - Configured `schema.prisma` with SQLite provider.
  - Created `.env` and `.env.example` with SQLite file path.
- **Key Takeaway**: Initializing directly in the root workspace required preserving repository git history while ensuring Next.js build scripts were correctly configured for the environment.

---

### Interaction 2: Data Modeling for Visitors & Photos
- **Developer Prompt**:
  > "Create the Prisma models for Visitor and Photo. Visitor needs an id (UUID), name, contact (@unique), and createdAt. Photo needs an id, visitorId relation, imageUrl, consentGiven boolean, status ('QUEUED' | 'PLAYED'), playCount (default 0), and createdAt."
- **AI Response Summary**:
  - Drafted `schema.prisma` with `Visitor` and `Photo` models.
  - Configured `@default(uuid())` on primary keys and `@default(now())` on timestamp fields.
  - Added relation with `onDelete: Cascade` on the `Photo.visitor` foreign key.
- **Key Takeaway**: Establishing `onDelete: Cascade` ensures that when a visitor requests deletion of their data under privacy controls, all associated photos are cleanly purged.

---

### Interaction 3: Upload API & Concurrency Handling (`/api/upload`)
- **Developer Prompt**:
  > "Build POST `/api/upload` accepting multipart/form-data with name, contact, consent ('true'), and 1-3 photos. Validate types and size (max 5MB), save files to `public/uploads/` using `crypto.randomUUID()`, upsert the visitor by contact, and return `isReturningVisitor` and `queuedPhotosCount`."
- **AI Response Summary**:
  - Created route handler parsing `FormData`.
  - Implemented server-side validation rejecting missing fields, invalid MIME types, or oversized files.
  - Implemented file persistence using `crypto.randomUUID()`.
- **Key Takeaway**: Concurrency safety requires UUID-based naming so simultaneous uploads with identical original filenames (e.g., `image.jpg`) never collide.

---

### Interaction 4: Slideshow Queue with Continuous Loop (`/api/slideshow`)
- **Developer Prompt**:
  > "Implement GET `/api/slideshow` with optional `limit` (default 20). Return `status: 'QUEUED'` photos first (FIFO by createdAt asc), backfilled with `status: 'PLAYED'` photos (createdAt desc) so the screen is never blank. Include visitor.name, visitor.createdAt, and an `isReturningVisitor` flag."
- **AI Response Summary**:
  - Built two-stage Prisma query selecting QUEUED photos first, then querying PLAYED photos if remaining capacity allows.
  - Computed `isReturningVisitor: boolean` based on visitor photo count and creation timestamps.
  - Returned `{ photos, slideDurationSeconds: 8 }`.
- **Key Takeaway**: The backfill query prevents museum and exhibition screens from displaying an awkward blank canvas once initial queues are drained.

---

### Interaction 5: Slideshow Playback Acknowledgment (`/api/slideshow/ack`)
- **Developer Prompt**:
  > "Build POST `/api/slideshow/ack` accepting `{ photoId }`. Mark the photo as 'PLAYED' and increment playCount by 1 after the TV displays it."
- **AI Response Summary**:
  - Created route handler verifying existence of `photoId`.
  - Executed atomic Prisma update: `status: "PLAYED"` and `playCount: { increment: 1 }`.
  - Returned updated photo object.
- **Key Takeaway**: Decoupling queue fetching from playback acknowledgment allows the TV display to control the exact duration of each slide before committing the state change.

---

### Interaction 6: Visitor Privacy & Self-Service Photo Removal (`/api/visitor/photos`)
- **Developer Prompt**:
  > "Implement GET and DELETE on `/api/visitor/photos`. GET returns all photos for a contact. DELETE accepts `{ contact, photoId? }`, verifies ownership, safely removes the file from disk, and deletes the record from Prisma. If photoId is omitted, delete all photos for that visitor."
- **AI Response Summary**:
  - Implemented `GET` handler returning visitor profile and photo history.
  - Implemented `DELETE` handler with safe file deletion using `path.basename` and path boundary checks to prevent path traversal.
- **Key Takeaway**: Real privacy controls require removing both database records and physical binary files from disk storage.

---

### Interaction 7: Warm Editorial Gallery Frontend & Display Interface
- **Developer Prompt**:
  > "Build the frontend UI using the Warm Editorial Gallery Theme (cream `#FAF6F0`, espresso `#2C221E`, terracotta `#B85A3A`). Create a dual-tab Check-In & Privacy page at `/` with Polaroid photo previews, and a full-viewport museum TV display at `/display` with ambient blurred backdrop, exhibition plaques, and an 8-second animated progress bar."
- **AI Response Summary**:
  - Built [`src/app/page.tsx`](file:///c:/Users/ASUS/Desktop/ass1/src/app/page.tsx) with Polaroid photo cards, drag-and-drop, client-side validation, and privacy deletion controls.
  - Built [`src/app/display/page.tsx`](file:///c:/Users/ASUS/Desktop/ass1/src/app/display/page.tsx) with dark wall aesthetic (`#1F1714`), blurred ambient backlight, framed canvas, and polling loop.
- **Key Takeaway**: Clear visual design that resembles physical museum exhibition plaques enhances visitor trust and engagement.

---

## 2. In-Depth Analysis: 3 Concrete AI Mistakes & Corrections

### Case 1: Returning Visitor Older Photos Re-queue Bug

#### The Mistake
During the initial implementation of `/api/upload`, the AI correctly detected returning visitors and set `isReturningVisitor: true`. However, it only marked the *newly uploaded photos* as `"QUEUED"`. It completely neglected to reset the visitor's *older, previously played photos* from `"PLAYED"` back to `"QUEUED"`.

#### How We Spotted It
During end-to-end testing with `scripts/test-api.ts`:
1. Alice uploaded 2 initial photos $\rightarrow$ both were displayed and marked as `"PLAYED"`.
2. Alice returned later and uploaded 1 new photo.
3. When querying `/api/slideshow`, only Alice's 1 new photo appeared in the high-priority queue. Her previous 2 photos remained marked as `"PLAYED"` and languished at the end of the backfill loop instead of playing together as an updated collection.

#### How We Fixed It
We added an explicit bulk update query in [`src/app/api/upload/route.ts`](file:///c:/Users/ASUS/Desktop/ass1/src/app/api/upload/route.ts):

```typescript
// If the visitor already existed and has older photos,
// update older photos' status back to "QUEUED" so both old and new play together
if (isReturningVisitor) {
  await prisma.photo.updateMany({
    where: {
      visitorId: visitor.id,
    },
    data: {
      status: "QUEUED",
    },
  });
}
```

This was immediately incorporated into Test 5 of the automated test suite to ensure regression prevention.

---

### Case 2: Contact Normalization Mismatch Creating Duplicate Visitors

#### The Mistake
Initially, the contact string was passed directly to `prisma.visitor.upsert({ where: { contact } })` without sanitization. As a result:
- `"Alice@example.com "` and `"alice@example.com"` were treated as two distinct visitors.
- A visitor who entered `"+1 (555) 234-5678"` on their first visit and `"5552345678"` on their second visit was not recognized as a returning visitor. Furthermore, when attempting to delete photos in `/api/visitor/photos`, a slight whitespace or formatting difference caused a 404 "Visitor not found" error.

#### How We Spotted It
During edge-case validation testing:
1. Checked in as `"  Alice@Example.COM  "`.
2. Attempted to load photos on the Privacy tab using `"alice@example.com"`.
3. The API returned `photos: []` because the database stored the raw unnormalized string with leading spaces and uppercase letters.

#### How We Fixed It
We created a centralized normalization utility in [`src/lib/contact.ts`](file:///c:/Users/ASUS/Desktop/ass1/src/lib/contact.ts):

```typescript
export function normalizeContact(contact: string): string {
  const trimmed = contact.trim();
  if (trimmed.includes("@")) {
    return trimmed.toLowerCase();
  }
  // Strip spaces, dashes, brackets, and symbols for phone numbers
  return trimmed.replace(/\D/g, "");
}
```

This helper was applied consistently across `/api/upload`, `GET /api/visitor/photos`, and `DELETE /api/visitor/photos`, ensuring identical key resolution across all user touchpoints.

---

### Case 3: Client-Only vs. Server-Side File Validation & Timestamp Collision Race

#### The Mistake
In early drafts, file validation (checking MIME type and the 5MB size limit) only existed in client-side `<input accept="..." />` handlers. An attacker or malfunctioning client could POST a 50MB file or a non-image file directly to `/api/upload`. Additionally, file saving used `Date.now() + "_" + file.name`, which:
1. Created race condition collision risks if two visitors uploaded simultaneously within the same millisecond.
2. Exposed original visitor filenames (which could contain special characters or directory traversal sequences).

#### How We Spotted It
During architectural code review and security boundary inspection:
- Running an API test bypassing the browser form proved that non-image payloads were accepted.
- Rapid-fire concurrent uploads with identical filenames risked partial file overwriting.

#### How We Fixed It
1. Implemented **strict server-side validation** in [`src/app/api/upload/route.ts`](file:///c:/Users/ASUS/Desktop/ass1/src/app/api/upload/route.ts):
   ```typescript
   const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
   const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

   for (const file of files) {
     if (!ALLOWED_MIME_TYPES.has(file.type)) {
       return NextResponse.json({ success: false, error: "Invalid file type." }, { status: 400 });
     }
     if (file.size > MAX_FILE_SIZE) {
       return NextResponse.json({ success: false, error: "File exceeds 5MB." }, { status: 400 });
     }
   }
   ```
2. Replaced timestamp naming with collision-proof `crypto.randomUUID()`:
   ```typescript
   const ext = MIME_TO_EXT[file.type] || ".jpg";
   const uniqueFilename = `${crypto.randomUUID()}${ext}`;
   const filePath = path.join(uploadsDir, uniqueFilename);
   ```
3. Added Test 2a and Test 2b to [`scripts/test-api.ts`](file:///c:/Users/ASUS/Desktop/ass1/scripts/test-api.ts) verifying server-side rejection of PDF files and payloads exceeding 3 photos.
