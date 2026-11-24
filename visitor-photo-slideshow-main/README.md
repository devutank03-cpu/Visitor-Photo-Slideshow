# Visitor Photo Slideshow & Exhibition Display

live link :- https://visitor-photo-slideshow-tau.vercel.app/

A full-stack, privacy-conscious event photography and exhibition slideshow application built with **Next.js 14+ (App Router)**, **TypeScript**, **Tailwind CSS**, **Prisma ORM with PostgreSQL (Neon)**, and **Cloudinary** for persistent media storage. Vercel deployment ready.

Designed for museum exhibitions, art galleries, and experiential events, the platform enables guests to check in and submit photos while simultaneously driving a live Smart TV / large-screen digital exhibition with intelligent queue looping.

---

## Key Features

- **Warm Editorial Gallery Theme**: Designed with an artisanal museum palette—warm cream surfaces (`#FAF6F0`), deep espresso serif headings (`#2C221E`), terracotta primary accents (`#B85A3A`), and subtle borders (`#E2D7C7`).
- **Visitor Check-In & Photo Upload (`/`)**:
  - Full Name and Phone/Email capture.
  - Drag-and-drop / file picker for 1 to 3 photos (JPEG, PNG, WebP up to 5MB each).
  - **Polaroid-style thumbnails**: authentic tilted frames, file metadata, and remove buttons.
  - Explicit privacy and public display consent checkbox.
- **Returning Visitor Recognition**:
  - Contact normalization (email lowercase/trimming, phone digits-only).
  - Automatically identifies returning visitors without requiring password registration.
  - Re-queues older photos so the visitor's full collection plays together on screen.
- **Smart TV / Museum Exhibition Display (`/display`)**:
  - Full-viewport, zero-scroll dark espresso gallery wall (`#1F1714`).
  - Ambient blurred backdrop reflecting the active photograph.
  - Centered framed canvas with smooth crossfade transitions.
  - Gallery glass plaque overlay featuring the visitor's name and a **"★ Welcome Back • Returning Visitor"** badge.
  - Real-time 8-second countdown progress bar matching `slideDurationSeconds`.
  - 5-second polling loop picking up new submissions immediately.
  - Automatic FIFO queueing with continuous backfill looping (screen never goes blank).
- **Self-Service Privacy Controls**:
  - Dedicated "Manage / Delete My Photos" tab.
  - Visitors can search by contact identifier to view, individually remove, or bulk-purge all photos from both SQLite and disk storage.

---

## Tech Stack

| Technology | Purpose |
| :--- | :--- |
| **Next.js 14+ (App Router)** | Full-stack React framework with API Route Handlers |
| **TypeScript 5+** | End-to-end type safety across backend and UI |
| **Tailwind CSS v4** | Custom Warm Editorial Gallery theme and responsive layouts |
| **Prisma ORM (v6.4)** | Type-safe database queries and schema migrations |
| **PostgreSQL (Neon)** | Serverless cloud PostgreSQL database ready for Vercel |
| **Cloudinary** | Production cloud media storage with CDN image delivery |

---

## Project Structure

```text
.
├── prisma/
│   ├── schema.prisma          # Visitor & Photo database models
│   └── dev.db                 # SQLite database file (created on db push)
├── public/
│   └── uploads/               # Saved visitor photos (UUID-named)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── slideshow/
│   │   │   │   ├── ack/route.ts       # POST: Acknowledge slide presentation
│   │   │   │   └── route.ts           # GET: FIFO queue & backfill loop
│   │   │   ├── upload/route.ts        # POST: File upload & visitor check-in
│   │   │   └── visitor/photos/route.ts# GET & DELETE: Privacy controls
│   │   ├── display/page.tsx   # Smart TV / Museum display (/display)
│   │   ├── globals.css        # Warm Editorial theme & custom keyframes
│   │   ├── layout.tsx         # Root HTML layout with system typography
│   │   └── page.tsx           # Visitor Check-In & Privacy portal (/)
│   └── lib/
│       ├── contact.ts         # Contact normalization helper (email & phone)
│       └── prisma.ts          # Singleton PrismaClient instance
├── scripts/
│   └── test-api.ts            # Automated end-to-end test suite
├── ARCHITECTURE.md            # Technical specifications & Mermaid diagrams
├── ASSUMPTIONS.md             # Design trade-offs & gap analysis
├── AI_LOG.md                  # Development prompts & mistake remediation
├── TEST_PLAN.md               # Automated & manual test execution plan
└── README.md                  # Project overview & documentation
```

---

## Getting Started

### Prerequisites
- **Node.js**: v18.18+ or v20+ (tested on Node v24)
- **npm**: v9+ (or pnpm / yarn)

### Step-by-Step Local Setup

1. **Clone the repository and enter the directory**:
   ```bash
   git clone https://github.com/aryannayi/visitor-photo-slideshow.git
   cd visitor-photo-slideshow
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   # On macOS/Linux
   cp .env.example .env

   # On Windows (PowerShell)
   Copy-Item .env.example .env
   ```
   *Populate `DATABASE_URL` (PostgreSQL / Neon) and your Cloudinary credentials (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`).*

4. **Initialize the PostgreSQL database schema**:
   ```bash
   npx prisma db push
   ```

5. **Start the development server**:
   ```bash
   npm run dev
   ```

6. **Open the applications in your browser**:
   - **Visitor Check-In & Privacy Form**: [http://localhost:3000](http://localhost:3000)
   - **Smart TV Exhibition Display**: [http://localhost:3000/display](http://localhost:3000/display)

---

## Running the Automated Test Suite

The repository includes a comprehensive standalone test script covering all API endpoints, edge-case validations, returning visitor queue updates, and photo deletions:

```bash
npx tsx scripts/test-api.ts
```

### Verification Commands
```bash
# Verify ESLint rules
npm run lint

# Verify Next.js production build
npm run build
```

---

## API Reference

### 1. `POST /api/upload`
Uploads 1–3 photographs with visitor check-in metadata.
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `name`: string (required)
  - `contact`: string email or phone (required)
  - `consent`: `"true"` (strictly required)
  - `photos`: 1 to 3 image files (JPEG, PNG, WebP $\le$ 5MB each)
- **Response**: `201 Created`
  ```json
  {
    "success": true,
    "isReturningVisitor": false,
    "visitor": {
      "id": "uuid",
      "name": "Jane Doe",
      "contact": "jane@example.com",
      "createdAt": "2026-11-24T12:00:00.000Z"
    },
    "queuedPhotosCount": 2
  }
  ```

### 2. `GET /api/slideshow`
Returns the active photo playlist for the Smart TV display.
- **Query Params**: `limit` (optional, default `20`)
- **Ordering**: Unplayed `status: "QUEUED"` photos first (`createdAt asc`), followed by `status: "PLAYED"` photos (`createdAt desc`).
- **Response**: `200 OK`
  ```json
  {
    "photos": [
      {
        "id": "uuid",
        "visitorId": "uuid",
        "imageUrl": "/uploads/example.jpg",
        "status": "QUEUED",
        "playCount": 0,
        "createdAt": "2026-11-24T12:05:00.000Z",
        "visitor": {
          "name": "Jane Doe",
          "createdAt": "2026-11-24T12:00:00.000Z"
        },
        "isReturningVisitor": false
      }
    ],
    "slideDurationSeconds": 8
  }
  ```

### 3. `POST /api/slideshow/ack`
Acknowledges that the TV display finished showing a slide.
- **Body**: `{ "photoId": "uuid" }`
- **Action**: Marks photo as `status: "PLAYED"` and increments `playCount` by 1.

### 4. `GET /api/visitor/photos?contact=...`
Returns all photos belonging to a given visitor for self-service privacy review.

### 5. `DELETE /api/visitor/photos`
Purges photo files from disk and removes database records.
- **Body**: `{ "contact": "jane@example.com", "photoId": "optional-uuid" }`
- **Action**: Deletes the specified photo (or all visitor photos if `photoId` is omitted).
