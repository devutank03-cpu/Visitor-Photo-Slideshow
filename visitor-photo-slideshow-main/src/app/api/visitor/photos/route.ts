import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { prisma } from "@/lib/prisma";
import { normalizeContact } from "@/lib/contact";
import { deleteCloudinaryAsset } from "@/lib/cloudinary";

/**
 * Safely deletes a photo file from public/uploads to prevent directory traversal
 */
async function safeDeletePhotoFile(imageUrl: string) {
  if (!imageUrl || typeof imageUrl !== "string") return;

  const uploadsDir = path.resolve(process.cwd(), "public", "uploads");
  const filename = path.basename(imageUrl);
  const resolvedPath = path.resolve(uploadsDir, filename);

  // Security check: ensure path is strictly inside public/uploads
  if (!resolvedPath.startsWith(uploadsDir)) {
    console.warn(`Blocked potentially unsafe file deletion path: ${imageUrl}`);
    return;
  }

  try {
    if (fsSync.existsSync(resolvedPath)) {
      await fs.unlink(resolvedPath);
    }
  } catch (err) {
    console.error(`Error deleting file ${resolvedPath}:`, err);
  }
}

// GET /api/visitor/photos?contact=...
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawContact = searchParams.get("contact");

    if (!rawContact || !rawContact.trim()) {
      return NextResponse.json(
        { success: false, error: "Contact parameter is required." },
        { status: 400 }
      );
    }

    const contact = normalizeContact(rawContact);
    if (!contact) {
      return NextResponse.json(
        { success: false, error: "Invalid contact format." },
        { status: 400 }
      );
    }

    const visitor = await prisma.visitor.findUnique({
      where: { contact },
      include: {
        photos: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!visitor) {
      return NextResponse.json({
        success: true,
        visitor: null,
        photos: [],
      });
    }

    return NextResponse.json({
      success: true,
      visitor: {
        id: visitor.id,
        name: visitor.name,
        contact: visitor.contact,
        createdAt: visitor.createdAt,
      },
      photos: visitor.photos,
    });
  } catch (error: unknown) {
    if ((error as { digest?: string })?.digest === "NEXT_PRERENDER_INTERRUPTED") {
      throw error;
    }
    console.error("Error fetching visitor photos:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch visitor photos." },
      { status: 500 }
    );
  }
}

// DELETE /api/visitor/photos
// Body: { contact: string, photoId?: string }
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || !body.contact || typeof body.contact !== "string" || !body.contact.trim()) {
      return NextResponse.json(
        { success: false, error: "Contact is required." },
        { status: 400 }
      );
    }

    const contact = normalizeContact(body.contact);
    if (!contact) {
      return NextResponse.json(
        { success: false, error: "Invalid contact format." },
        { status: 400 }
      );
    }

    const visitor = await prisma.visitor.findUnique({
      where: { contact },
    });

    if (!visitor) {
      return NextResponse.json(
        { success: false, error: "Visitor not found." },
        { status: 404 }
      );
    }

    const photoId = body.photoId;

    if (photoId) {
      // Delete a single photo verifying ownership
      if (typeof photoId !== "string" || !photoId.trim()) {
        return NextResponse.json(
          { success: false, error: "Invalid photoId format." },
          { status: 400 }
        );
      }

      const photo = await prisma.photo.findFirst({
        where: {
          id: photoId,
          visitorId: visitor.id,
        },
      });

      if (!photo) {
        return NextResponse.json(
          {
            success: false,
            error: "Photo not found or does not belong to this visitor.",
          },
          { status: 404 }
        );
      }

      // Delete from Cloudinary if remote, or local disk if local path
      if (photo.imageUrl.startsWith("http://") || photo.imageUrl.startsWith("https://")) {
        await deleteCloudinaryAsset(photo.imageUrl);
      } else {
        await safeDeletePhotoFile(photo.imageUrl);
      }

      // Delete record from Prisma
      await prisma.photo.delete({
        where: { id: photo.id },
      });

      return NextResponse.json({
        success: true,
        message: "Photo deleted successfully.",
        deletedPhotoId: photo.id,
      });
    } else {
      // Delete all photos for this visitor
      const photos = await prisma.photo.findMany({
        where: { visitorId: visitor.id },
      });

      for (const p of photos) {
        if (p.imageUrl.startsWith("http://") || p.imageUrl.startsWith("https://")) {
          await deleteCloudinaryAsset(p.imageUrl);
        } else {
          await safeDeletePhotoFile(p.imageUrl);
        }
      }

      const result = await prisma.photo.deleteMany({
        where: { visitorId: visitor.id },
      });

      return NextResponse.json({
        success: true,
        message: `All photos (${result.count}) deleted successfully.`,
        deletedCount: result.count,
      });
    }
  } catch (error) {
    console.error("Error deleting visitor photo(s):", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete photo(s)." },
      { status: 500 }
    );
  }
}
