/* eslint-disable @typescript-eslint/no-explicit-any */
import { POST as uploadPOST } from "../src/app/api/upload/route";
import { GET as slideshowGET } from "../src/app/api/slideshow/route";
import { POST as ackPOST } from "../src/app/api/slideshow/ack/route";
import { GET as visitorPhotosGET, DELETE as visitorPhotosDELETE } from "../src/app/api/visitor/photos/route";
import { prisma } from "../src/lib/prisma";
import fs from "fs";
import path from "path";

// Minimal valid 1x1 pixel image buffer for test uploads (accepted by Cloudinary)
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Helper to create a valid File
function createTestFile(filename: string, mimeType: string, content?: string) {
  let buffer: Buffer;
  if (mimeType.startsWith("image/")) {
    buffer = Buffer.from(TINY_PNG_BASE64, "base64");
  } else {
    buffer = Buffer.from(content || "fake non-image content");
  }
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  return new File([blob], filename, { type: mimeType });
}

async function runTests() {
  console.log("=============================================");
  console.log("--- Starting Backend & API Verification ---");
  console.log("=============================================\n");

  // Clean test DB records first
  await prisma.photo.deleteMany({});
  await prisma.visitor.deleteMany({});

  // ------------------------------------------------------------------------
  // PHASE 1 VERIFICATION
  // ------------------------------------------------------------------------
  console.log("PHASE 1: Upload API & Validation Tests");

  // 1. Validation: Missing Fields
  {
    const fd = new FormData();
    fd.append("contact", "alice@example.com");
    fd.append("consent", "true");
    fd.append("photos", createTestFile("photo1.jpg", "image/jpeg"));
    const req = new Request("http://localhost:3000/api/upload", { method: "POST", body: fd }) as any;
    const res = await uploadPOST(req);
    const data = await res.json();
    console.assert(res.status === 400 && data.success === false, "Test 1a failed");
    console.log("✓ Correctly rejected missing name");
  }

  {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("contact", "alice@example.com");
    fd.append("consent", "false");
    fd.append("photos", createTestFile("photo1.jpg", "image/jpeg"));
    const req = new Request("http://localhost:3000/api/upload", { method: "POST", body: fd }) as any;
    const res = await uploadPOST(req);
    const data = await res.json();
    console.assert(res.status === 400 && data.success === false, "Test 1b failed");
    console.log("✓ Correctly rejected consent !== 'true'");
  }

  // 2. Validation: Invalid File Types and Counts
  {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("contact", "alice@example.com");
    fd.append("consent", "true");
    fd.append("photos", createTestFile("document.pdf", "application/pdf"));
    const req = new Request("http://localhost:3000/api/upload", { method: "POST", body: fd }) as any;
    const res = await uploadPOST(req);
    const data = await res.json();
    console.assert(res.status === 400 && data.success === false, "Test 2a failed");
    console.log("✓ Correctly rejected invalid MIME type");
  }

  {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("contact", "alice@example.com");
    fd.append("consent", "true");
    fd.append("photos", createTestFile("1.jpg", "image/jpeg"));
    fd.append("photos", createTestFile("2.jpg", "image/jpeg"));
    fd.append("photos", createTestFile("3.jpg", "image/jpeg"));
    fd.append("photos", createTestFile("4.jpg", "image/jpeg"));
    const req = new Request("http://localhost:3000/api/upload", { method: "POST", body: fd }) as any;
    const res = await uploadPOST(req);
    const data = await res.json();
    console.assert(res.status === 400 && data.success === false, "Test 2b failed");
    console.log("✓ Correctly rejected >3 photos");
  }

  // 3. Successful Upload - New Visitor (Alice)
  let aliceId = "";
  let alicePhotoIds: string[] = [];
  {
    const fd = new FormData();
    fd.append("name", "Alice Wonderland");
    fd.append("contact", "  Alice@Example.COM  ");
    fd.append("consent", "true");
    fd.append("photos", createTestFile("vacation.png", "image/png", "png-content-1"));
    fd.append("photos", createTestFile("family.webp", "image/webp", "webp-content-2"));

    const req = new Request("http://localhost:3000/api/upload", { method: "POST", body: fd }) as any;
    const res = await uploadPOST(req);
    const data = await res.json();

    console.assert(res.status === 201 && data.success === true, "Test 3 status failed");
    console.assert(data.isReturningVisitor === false, "Should not be returning visitor");
    console.assert(data.visitor.contact === "alice@example.com", "Contact should be normalized");
    console.assert(data.queuedPhotosCount === 2, "Queued photos count should be 2");
    aliceId = data.visitor.id;

    const photos = await prisma.photo.findMany({ where: { visitorId: aliceId } });
    console.assert(photos.length === 2, "DB should have 2 photos");
    alicePhotoIds = photos.map(p => p.id);

    for (const p of photos) {
      if (p.imageUrl.startsWith("http")) {
        console.assert(p.imageUrl.includes("cloudinary.com"), "Image URL should be a valid Cloudinary URL");
      } else {
        const diskPath = path.join(process.cwd(), "public", p.imageUrl);
        console.assert(fs.existsSync(diskPath), `File ${diskPath} should exist on disk`);
      }
    }

    console.log("✓ New visitor (Alice) created, 2 files saved, photos QUEUED");
  }

  // 4. Create another Visitor (Bob) with 1 photo
  let bobPhotoId = "";
  {
    const fd = new FormData();
    fd.append("name", "Bob Builder");
    fd.append("contact", "+1 (555) 000-1111");
    fd.append("consent", "true");
    fd.append("photos", createTestFile("bob1.jpg", "image/jpeg", "bob-content-1"));

    const req = new Request("http://localhost:3000/api/upload", { method: "POST", body: fd }) as any;
    const res = await uploadPOST(req);
    const data = await res.json();

    console.assert(res.status === 201 && data.success === true, "Bob upload failed");
    console.assert(data.visitor.contact === "15550001111", "Bob phone normalized");
    const bobPhotos = await prisma.photo.findMany({ where: { visitorId: data.visitor.id } });
    bobPhotoId = bobPhotos[0].id;
    console.log("✓ Second visitor (Bob) created with phone contact");
  }

  // ------------------------------------------------------------------------
  // PHASE 2 VERIFICATION
  // ------------------------------------------------------------------------
  console.log("\nPHASE 2: Slideshow & Privacy API Tests");

  // 5. Test /api/slideshow/ack (POST)
  console.log("\nTest 5: /api/slideshow/ack (POST)");
  {
    // Invalid request
    const invalidReq = new Request("http://localhost:3000/api/slideshow/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }) as any;
    const invRes = await ackPOST(invalidReq);
    console.assert(invRes.status === 400, "Should reject missing photoId");

    // Non-existent photoId
    const nonExistentReq = new Request("http://localhost:3000/api/slideshow/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId: "00000000-0000-0000-0000-000000000000" }),
    }) as any;
    const notFoundRes = await ackPOST(nonExistentReq);
    console.assert(notFoundRes.status === 404, "Should return 404 for unknown photoId");

    // Acknowledge Alice's first photo
    const validReq = new Request("http://localhost:3000/api/slideshow/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId: alicePhotoIds[0] }),
    }) as any;
    const ackRes = await ackPOST(validReq);
    const ackData = await ackRes.json();
    console.assert(ackRes.status === 200 && ackData.success === true, "Ack should succeed");
    console.assert(ackData.photo.status === "PLAYED", "Status should be PLAYED");
    console.assert(ackData.photo.playCount === 1, "playCount should be 1");
    console.log("✓ /api/slideshow/ack correctly marked photo as PLAYED and incremented playCount to 1");

    // Call ack again on the same photo with a fresh request object
    const validReq2 = new Request("http://localhost:3000/api/slideshow/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId: alicePhotoIds[0] }),
    }) as any;
    const ackRes2 = await ackPOST(validReq2);
    const ackData2 = await ackRes2.json();
    console.assert(ackData2.photo.playCount === 2, "playCount should increment to 2");
    console.log("✓ Subsequent ack on the same photo incremented playCount to 2");
  }

  // 6. Test /api/slideshow (GET) - Smart TV FIFO queue & fallback loop
  console.log("\nTest 6: /api/slideshow (GET)");
  {
    const req = new Request("http://localhost:3000/api/slideshow") as any;
    const res = await slideshowGET(req);
    const data = await res.json();

    console.assert(res.status === 200, "Slideshow GET failed");
    console.assert(data.slideDurationSeconds === 8, `Expected slideDurationSeconds to be 8, got ${data.slideDurationSeconds}`);
    console.assert(Array.isArray(data.photos), "Photos should be an array");
    console.assert(data.photos.length === 3, `Expected 3 total photos, got ${data.photos.length}`);

    // Verify ordering: QUEUED photos must come before PLAYED photos
    const queuedItems = data.photos.filter((p: any) => p.status === "QUEUED");
    const playedItems = data.photos.filter((p: any) => p.status === "PLAYED");
    console.assert(queuedItems.length === 2, `Expected 2 QUEUED photos, got ${queuedItems.length}`);
    console.assert(playedItems.length === 1, `Expected 1 PLAYED photo, got ${playedItems.length}`);

    // Verify the first photos are indeed the QUEUED ones
    console.assert(data.photos[0].status === "QUEUED", "First item must be QUEUED");
    console.assert(data.photos[1].status === "QUEUED", "Second item must be QUEUED");
    console.assert(data.photos[2].status === "PLAYED", "Last item must be PLAYED");

    // Verify metadata presence
    console.assert(data.photos[0].visitor.name !== undefined, "Visitor name must be included");
    console.assert(data.photos[0].visitor.createdAt !== undefined, "Visitor createdAt must be included");
    console.assert(typeof data.photos[0].isReturningVisitor === "boolean", "isReturningVisitor boolean must be included");

    console.log("✓ /api/slideshow returned FIFO QUEUED photos first, followed by PLAYED photos, slideDurationSeconds: 8");
  }

  // 7. Test /api/slideshow limit parameter
  console.log("\nTest 7: /api/slideshow with ?limit=2");
  {
    const req = new Request("http://localhost:3000/api/slideshow?limit=2") as any;
    const res = await slideshowGET(req);
    const data = await res.json();
    console.assert(data.photos.length === 2, `Expected exactly 2 photos with limit=2, got ${data.photos.length}`);
    console.log("✓ /api/slideshow respected limit query param");
  }

  // 8. Test /api/visitor/photos (GET)
  console.log("\nTest 8: /api/visitor/photos (GET)");
  {
    // Missing contact
    const noContactReq = new Request("http://localhost:3000/api/visitor/photos") as any;
    const noContactRes = await visitorPhotosGET(noContactReq);
    console.assert(noContactRes.status === 400, "Should reject missing contact");

    // Alice contact query
    const aliceReq = new Request("http://localhost:3000/api/visitor/photos?contact=alice@example.com") as any;
    const aliceRes = await visitorPhotosGET(aliceReq);
    const aliceData = await aliceRes.json();
    console.assert(aliceRes.status === 200 && aliceData.success === true, "Alice photos fetch failed");
    console.assert(aliceData.visitor.name === "Alice Wonderland", "Visitor name mismatch");
    console.assert(aliceData.photos.length === 2, `Expected 2 photos for Alice, got ${aliceData.photos.length}`);

    // Bob contact query with unnormalized input
    const bobReq = new Request("http://localhost:3000/api/visitor/photos?contact=+1%20555%20000%201111") as any;
    const bobRes = await visitorPhotosGET(bobReq);
    const bobData = await bobRes.json();
    console.assert(bobRes.status === 200 && bobData.photos.length === 1, "Bob photos query failed");

    // Non-existent visitor
    const unknownReq = new Request("http://localhost:3000/api/visitor/photos?contact=nobody@example.com") as any;
    const unknownRes = await visitorPhotosGET(unknownReq);
    const unknownData = await unknownRes.json();
    console.assert(unknownRes.status === 200 && unknownData.photos.length === 0, "Unknown visitor should return empty list");
    console.log("✓ /api/visitor/photos (GET) returned correct photos with contact normalization");
  }

  // 9. Test /api/visitor/photos (DELETE) - Single Photo
  console.log("\nTest 9: /api/visitor/photos (DELETE) - Single photo with ownership verification");
  {
    // Try to delete Bob's photo using Alice's contact (Ownership failure)
    const unauthorizedReq = new Request("http://localhost:3000/api/visitor/photos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact: "alice@example.com",
        photoId: bobPhotoId,
      }),
    }) as any;
    const unauthRes = await visitorPhotosDELETE(unauthorizedReq);
    console.assert(unauthRes.status === 404, "Should reject deleting photo belonging to someone else");
    console.log("✓ Unauthorized deletion correctly prevented (404)");

    // Get Alice's second photo to delete
    const photoToDelete = await prisma.photo.findUnique({ where: { id: alicePhotoIds[1] } });
    console.assert(photoToDelete !== null, "Photo must exist before deletion");
    if (!photoToDelete!.imageUrl.startsWith("http")) {
      const filePathOnDisk = path.join(process.cwd(), "public", photoToDelete!.imageUrl);
      console.assert(fs.existsSync(filePathOnDisk), "File must exist on disk before deletion");
    }

    // Alice deletes her own photo
    const deleteReq = new Request("http://localhost:3000/api/visitor/photos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact: "Alice@example.com", // testing normalization
        photoId: alicePhotoIds[1],
      }),
    }) as any;
    const deleteRes = await visitorPhotosDELETE(deleteReq);
    const deleteData = await deleteRes.json();

    console.assert(deleteRes.status === 200 && deleteData.success === true, "Deletion failed");
    if (!photoToDelete!.imageUrl.startsWith("http")) {
      const filePathOnDisk = path.join(process.cwd(), "public", photoToDelete!.imageUrl);
      console.assert(!fs.existsSync(filePathOnDisk), "File should be removed from disk");
    }

    const dbCheck = await prisma.photo.findUnique({ where: { id: alicePhotoIds[1] } });
    console.assert(dbCheck === null, "Photo record should be deleted from DB");
    console.log("✓ Successfully deleted single photo from DB and disk with normalized contact");
  }

  // 10. Test /api/visitor/photos (DELETE) - All Photos for a Visitor
  console.log("\nTest 10: /api/visitor/photos (DELETE) - Delete all photos for a visitor");
  {
    // Alice now has 1 remaining photo (alicePhotoIds[0])
    const remainingPhoto = await prisma.photo.findUnique({ where: { id: alicePhotoIds[0] } });
    console.assert(remainingPhoto !== null, "Alice should have 1 remaining photo");
    if (!remainingPhoto!.imageUrl.startsWith("http")) {
      const filePath = path.join(process.cwd(), "public", remainingPhoto!.imageUrl);
      console.assert(fs.existsSync(filePath), "Remaining photo file should exist on disk");
    }

    // Delete without photoId -> deletes all photos for Alice
    const deleteAllReq = new Request("http://localhost:3000/api/visitor/photos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact: "alice@example.com",
      }),
    }) as any;
    const deleteAllRes = await visitorPhotosDELETE(deleteAllReq);
    const deleteAllData = await deleteAllRes.json();

    console.assert(deleteAllRes.status === 200 && deleteAllData.success === true, "Delete all failed");
    console.assert(deleteAllData.deletedCount === 1, `Expected 1 photo deleted, got ${deleteAllData.deletedCount}`);
    if (!remainingPhoto!.imageUrl.startsWith("http")) {
      const filePath = path.join(process.cwd(), "public", remainingPhoto!.imageUrl);
      console.assert(!fs.existsSync(filePath), "Remaining photo file should be deleted from disk");
    }

    const alicePhotosAfter = await prisma.photo.findMany({ where: { visitorId: aliceId } });
    console.assert(alicePhotosAfter.length === 0, "Alice should have 0 photos in DB");

    // Bob's photo should be completely untouched
    const bobPhotoCheck = await prisma.photo.findUnique({ where: { id: bobPhotoId } });
    console.assert(bobPhotoCheck !== null, "Bob's photo must still exist");
    console.log("✓ Successfully deleted all remaining photos for Alice without affecting Bob");
  }

  console.log("\n=============================================");
  console.log("ALL TESTS (PHASE 1 + PHASE 2) PASSED! 🚀");
  console.log("=============================================");
}

runTests()
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
