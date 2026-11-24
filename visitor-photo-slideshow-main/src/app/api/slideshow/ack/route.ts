import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.photoId || typeof body.photoId !== "string") {
      return NextResponse.json(
        { success: false, error: "Valid photoId is required." },
        { status: 400 }
      );
    }

    const { photoId } = body;

    const existingPhoto = await prisma.photo.findUnique({
      where: { id: photoId },
    });

    if (!existingPhoto) {
      return NextResponse.json(
        { success: false, error: "Photo not found." },
        { status: 404 }
      );
    }

    const updatedPhoto = await prisma.photo.update({
      where: { id: photoId },
      data: {
        status: "PLAYED",
        playCount: {
          increment: 1,
        },
      },
    });

    return NextResponse.json({
      success: true,
      photo: updatedPhoto,
    });
  } catch (error) {
    console.error("Error acknowledging photo playback:", error);
    return NextResponse.json(
      { success: false, error: "Failed to acknowledge photo playback." },
      { status: 500 }
    );
  }
}

