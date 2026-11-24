import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    let limit = 20;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = parsed;
      }
    }

    // 1. Fetch newly uploaded or re-queued photos (FIFO: createdAt asc)
    const queuedPhotos = await prisma.photo.findMany({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: {
        visitor: {
          select: {
            name: true,
            createdAt: true,
            _count: {
              select: { photos: true },
            },
          },
        },
      },
    });

    // 2. If limit not reached, fetch already displayed photos (createdAt desc)
    // so the slideshow always has continuous content and never shows an empty screen
    let playedPhotos: typeof queuedPhotos = [];
    const remainingSlots = limit - queuedPhotos.length;

    if (remainingSlots > 0) {
      playedPhotos = await prisma.photo.findMany({
        where: { status: "PLAYED" },
        orderBy: { createdAt: "desc" },
        take: remainingSlots,
        include: {
          visitor: {
            select: {
              name: true,
              createdAt: true,
              _count: {
                select: { photos: true },
              },
            },
          },
        },
      });
    }

    const allPhotos = [...queuedPhotos, ...playedPhotos];

    const photos = allPhotos.map((p) => {
      const totalPhotos = p.visitor._count?.photos ?? 1;
      const timeDiffMs = p.createdAt.getTime() - p.visitor.createdAt.getTime();
      const isOlderThanVisitorBy1Min = timeDiffMs > 60 * 1000;
      const isReturningVisitor = totalPhotos > 1 || isOlderThanVisitorBy1Min;

      return {
        id: p.id,
        visitorId: p.visitorId,
        imageUrl: p.imageUrl,
        status: p.status,
        playCount: p.playCount,
        createdAt: p.createdAt,
        visitor: {
          name: p.visitor.name,
          createdAt: p.visitor.createdAt,
        },
        isReturningVisitor,
      };
    });

    return NextResponse.json({
      photos,
      slideDurationSeconds: 8,
    });
  } catch (error: unknown) {
    if ((error as { digest?: string })?.digest === "NEXT_PRERENDER_INTERRUPTED") {
      throw error;
    }
    console.error("Error fetching slideshow queue:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch slideshow queue" },
      { status: 500 }
    );
  }
}
