import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeContact } from "@/lib/contact";
import { uploadImageBuffer } from "@/lib/cloudinary";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const name = formData.get("name");
    const contact = formData.get("contact");
    const consent = formData.get("consent");

    // Server-side validation: Reject if name, contact, or consent !== "true" is missing
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "Name is required." },
        { status: 400 }
      );
    }

    if (!contact || typeof contact !== "string" || !contact.trim()) {
      return NextResponse.json(
        { success: false, error: "Contact (email or phone) is required." },
        { status: 400 }
      );
    }

    if (consent !== "true") {
      return NextResponse.json(
        {
          success: false,
          error: "Explicit consent is required (consent must be 'true').",
        },
        { status: 400 }
      );
    }

    const normalizedContact = normalizeContact(contact);
    if (!normalizedContact) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid contact format. Provide a valid email or phone number.",
        },
        { status: 400 }
      );
    }

    // Extract photos (handle 'photos', 'photos[]', or 'photo')
    const rawPhotoEntries = [
      ...formData.getAll("photos"),
      ...formData.getAll("photos[]"),
      ...formData.getAll("photo"),
    ];

    const files: File[] = [];
    for (const entry of rawPhotoEntries) {
      if (entry instanceof File && entry.size > 0) {
        files.push(entry);
      }
    }

    // Validate photo count (1 to 3 files)
    if (files.length < 1 || files.length > 3) {
      return NextResponse.json(
        {
          success: false,
          error: "Please upload between 1 and 3 photos.",
        },
        { status: 400 }
      );
    }

    // Validate each file MIME type and max size
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid file type for '${file.name}': ${file.type}. Allowed types are image/jpeg, image/png, and image/webp.`,
          },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            success: false,
            error: `File '${file.name}' exceeds the 5MB size limit (${(file.size / (1024 * 1024)).toFixed(2)}MB).`,
          },
          { status: 400 }
        );
      }
    }

    // Upload images directly to Cloudinary (folder: visitor-slideshow)
    const savedPhotoUrls: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());

      if (process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_CLOUD_NAME) {
        const uploadResult = await uploadImageBuffer(buffer, "visitor-slideshow");
        savedPhotoUrls.push(uploadResult.secure_url);
      } else {
        // Safe local fallback if Cloudinary credentials are not configured
        const uploadsDir = path.join(process.cwd(), "public", "uploads");
        await fs.mkdir(uploadsDir, { recursive: true });
        const ext = MIME_TO_EXT[file.type] || ".jpg";
        const uniqueFilename = `${crypto.randomUUID()}${ext}`;
        const filePath = path.join(uploadsDir, uniqueFilename);
        await fs.writeFile(filePath, buffer);
        savedPhotoUrls.push(`/uploads/${uniqueFilename}`);
      }
    }

    // Returning Visitor Logic
    // 1. Check if visitor already exists to determine isReturningVisitor
    const existingVisitor = await prisma.visitor.findUnique({
      where: { contact: normalizedContact },
    });
    const isReturningVisitor = Boolean(existingVisitor);

    // 2. Upsert visitor
    const visitor = await prisma.visitor.upsert({
      where: { contact: normalizedContact },
      update: {
        name: name.trim(),
      },
      create: {
        name: name.trim(),
        contact: normalizedContact,
      },
    });

    // 3. If visitor already existed and has older photos, update older photos' status back to "QUEUED"
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

    // 4. Create new photo records
    await prisma.photo.createMany({
      data: savedPhotoUrls.map((imageUrl) => ({
        visitorId: visitor.id,
        imageUrl,
        consentGiven: true,
        status: "QUEUED",
        playCount: 0,
      })),
    });

    // 5. Total queued photos count for this visitor (both older and new photos)
    const queuedPhotosCount = await prisma.photo.count({
      where: {
        visitorId: visitor.id,
        status: "QUEUED",
      },
    });

    return NextResponse.json(
      {
        success: true,
        isReturningVisitor,
        visitor,
        queuedPhotosCount,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Upload API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "An unexpected error occurred while processing the upload.",
      },
      { status: 500 }
    );
  }
}

