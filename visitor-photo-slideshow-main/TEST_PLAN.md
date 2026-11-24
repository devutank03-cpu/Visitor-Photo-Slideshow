# Quality Assurance & Test Verification Plan

This document details the test strategy, automated test matrix, manual test cases, security boundary validations, and execution procedures for the **Visitor Photo Slideshow** application.

---

## 1. Test Strategy Overview

The testing methodology combines **automated end-to-end API integration tests** with **manual kiosk and TV display verification** to validate performance, concurrency safety, data integrity, and privacy compliance.

```text
┌─────────────────────────────────────────────────────────────┐
│                       TEST COVERAGE                         │
├───────────────────────────────┬─────────────────────────────┤
│ 1. Input & File Validation    │ MIME types, 5MB limit, 1-3  │
│ 2. Concurrency & Storage      │ UUID collisions, disk sync  │
│ 3. Returning Visitor Logic    │ Contact normalization, FIFO │
│ 4. Slideshow Display Loop     │ 8s timer, ack, backfill     │
│ 5. Privacy & Data Purge       │ Individual / bulk removal   │
│ 6. Cross-Platform Build       │ TypeScript, ESLint, Next.js │
└───────────────────────────────┴─────────────────────────────┘
```

---

## 2. Automated Test Suite Matrix (`scripts/test-api.ts`)

The automated test script directly exercises the route handlers against a live SQLite database instance. Execute it with:

```bash
npx tsx scripts/test-api.ts
```

| Test ID | Test Scenario | Input / Action | Expected Result | Automated Status |
| :--- | :--- | :--- | :--- | :---: |
| **T01-A** | Missing Name Validation | POST `/api/upload` without `name` | HTTP 400 `{ success: false, error: "Name is required." }` | **PASS** |
| **T01-B** | Consent Checkbox Validation | POST `/api/upload` with `consent: "false"` | HTTP 400 `{ success: false, error: "...consent must be 'true'..." }` | **PASS** |
| **T02-A** | Disallowed MIME Type Rejection | POST `/api/upload` with `application/pdf` | HTTP 400 `{ success: false, error: "...Allowed types are image/jpeg, image/png, and image/webp." }` | **PASS** |
| **T02-B** | Excessive File Count Rejection | POST `/api/upload` with 4 photos | HTTP 400 `{ success: false, error: "Please upload between 1 and 3 photos." }` | **PASS** |
| **T03** | New Visitor Check-In & Storage | Check-in "Alice" with 2 photos (`.png`, `.webp`) and unnormalized contact `"  Alice@Example.COM  "` | HTTP 201 `{ isReturningVisitor: false }`; contact stored as `"alice@example.com"`; files saved in `public/uploads/` with UUID names; both photos have `status: "QUEUED"`. | **PASS** |
| **T04** | Slideshow Playback Simulation | Update Alice's 2 photos to `status: "PLAYED"` with `playCount: 1` | Database reflects 2 played photos awaiting backfill. | **PASS** |
| **T05** | Playback Acknowledgment API | POST `/api/slideshow/ack` with valid `photoId` | HTTP 200 `{ photo: { status: "PLAYED", playCount: 1 } }`. Calling a second time increments `playCount: 2`. | **PASS** |
| **T06** | Returning Visitor Re-Queueing | Check-in "Alice" with 1 new photo using normalized contact | HTTP 201 `{ isReturningVisitor: true, queuedPhotosCount: 3 }`. All 3 photos (2 old + 1 new) reset to `status: "QUEUED"`. | **PASS** |
| **T07** | Intelligent Slideshow Ordering | GET `/api/slideshow` | HTTP 200 `{ photos, slideDurationSeconds: 8 }`. Photos with `status: "QUEUED"` appear first (FIFO), followed by `status: "PLAYED"` photos. | **PASS** |
| **T08** | Slideshow Limit Parameter | GET `/api/slideshow?limit=2` | Returns exactly 2 photos honoring the query constraint. | **PASS** |
| **T09** | Visitor Privacy Fetch | GET `/api/visitor/photos?contact=alice@example.com` | HTTP 200 returning all 3 photos belonging to Alice. | **PASS** |
| **T10-A**| Unauthorized Deletion Prevention | DELETE `/api/visitor/photos` for Bob's photo with Alice's contact | HTTP 404 rejection; Bob's photo remains intact. | **PASS** |
| **T10-B**| Single Photo Privacy Deletion | DELETE `/api/visitor/photos` with Alice's contact and valid `photoId` | HTTP 200; photo record deleted from Prisma; physical file deleted from `public/uploads/`. | **PASS** |
| **T10-C**| Bulk Visitor Photo Purge | DELETE `/api/visitor/photos` with Alice's contact (no `photoId`) | HTTP 200; all remaining photos for Alice purged from DB and disk; other visitors unaffected. | **PASS** |

---

## 3. Manual Test Cases (Interactive Verification)

### Manual Scenario 1: Concurrent Photo Uploads & File Non-Collision
- **Objective**: Verify that two visitors simultaneously uploading identical image filenames do not overwrite each other.
- **Steps**:
  1. Open two browser windows side-by-side at `http://localhost:3000`.
  2. In Window A: Enter Name "Visitor A", contact "a@test.com", attach `photo.jpg`.
  3. In Window B: Enter Name "Visitor B", contact "b@test.com", attach `photo.jpg` (same original filename, different picture).
  4. Submit both forms within 1 second.
- **Expected Outcome**:
  - Both submissions return HTTP 201 with success banners.
  - Inspection of `public/uploads/` reveals two unique UUID filenames (e.g., `476a1bdb...jpg` and `67b81e90...jpg`).
  - Neither file is corrupted or overwritten.

### Manual Scenario 2: Client & Server Oversized File Rejection
- **Objective**: Verify that files over 5MB cannot be submitted.
- **Steps**:
  1. Open `http://localhost:3000`.
  2. Select an image file larger than 5MB (e.g., 8MB JPEG).
- **Expected Outcome**:
  - The dropzone immediately displays an inline red warning: `'filename.jpg' exceeds the 5MB size limit (8.0MB)`.
  - The file is rejected and not added to the Polaroid preview list.
  - If bypassed via curl/Postman, the backend returns HTTP 400 with a matching error message.

### Manual Scenario 3: Returning Visitor Re-queueing on the Smart TV Display
- **Objective**: Verify that when a returning visitor checks in, their older photos are re-queued and appear on the TV display with the "Welcome Back" badge.
- **Steps**:
  1. Open `http://localhost:3000/display` in a secondary tab.
  2. Check in as "Carlos Rivera" (`carlos@gallery.org`) and upload Photo 1.
  3. Observe Photo 1 playing on `/display` for 8 seconds.
  4. Once Photo 1 finishes and another slide appears, check in again as "Carlos Rivera" with `carlos@gallery.org` and upload Photo 2.
- **Expected Outcome**:
  - The check-in form displays: *"Welcome back! Your previous photos have also been re-queued alongside your new ones (2 photos currently queued)."*
  - The TV display picks up the updated queue on its 5-second poll.
  - When Carlos's slides appear, the bottom-left glass plaque displays Carlos's name and the terracotta badge: **"★ Welcome Back • Returning Visitor"**.

### Manual Scenario 4: Self-Service Photo Deletion & Immediate TV Removal
- **Objective**: Verify that deleting photos from the Privacy tab removes them from both disk and future slideshow loops.
- **Steps**:
  1. Navigate to `http://localhost:3000` and click the **"Manage / Privacy"** tab.
  2. Enter the email/phone used during check-in and click "Find Photos".
  3. Click "Remove" on one of the exhibited photos.
- **Expected Outcome**:
  - The photo immediately disappears from the management grid with a confirmation banner.
  - The image file is removed from `public/uploads/`.
  - On the next `/api/slideshow` poll, the TV display no longer includes the deleted photo.

### Manual Scenario 5: Ambient Backdrop & Kiosk Controls
- **Objective**: Verify fullscreen presentation, keyboard navigation, and ambient lighting on `/display`.
- **Steps**:
  1. Open `http://localhost:3000/display`.
  2. Press `F` on the keyboard (or click the fullscreen icon in the top right).
  3. Press `Space` or `→` to advance the slide manually.
  4. Press `P` to pause the 8-second countdown.
- **Expected Outcome**:
  - Screen enters native fullscreen mode without scrollbars.
  - Active slide transitions smoothly with a dynamic blurred ambient backlight.
  - Progress bar halts when paused, displaying `"PAUSED"`, and resumes on pressing `P` again.

---

## 4. Verification Checklists & Build Results

```bash
# 1. Database sync verification
npx prisma db push
# Output: The database is already in sync with the Prisma schema.

# 2. Automated test suite execution
npx tsx scripts/test-api.ts
# Output: ALL TESTS (PHASE 1 + PHASE 2) PASSED! 🚀

# 3. Static analysis & linting
npm run lint
# Output: Finished with exit code 0. Zero ESLint warnings or errors.

# 4. Production Next.js build
npm run build
# Output: Compiled successfully. Generated static pages and dynamic route handlers.
```
