import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadImage, uploadVideo } from "@/lib/meta/creatives";
import { db, schema } from "@/db";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // H8: Auth + admin check
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const creatives = await db.select().from(schema.creatives).orderBy(schema.creatives.createdAt);
    return NextResponse.json({ data: creatives });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch creatives" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const name = formData.get("name") as string || file.name;
    const tags = formData.get("tags") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const isVideo = file.type.startsWith("video/");

    let metaResult: { hash?: string; videoId?: string } = {};

    if (isVideo) {
      const result = await uploadVideo(buffer, file.name);
      metaResult = { videoId: result.id };
    } else {
      const result = await uploadImage(buffer, file.name);
      metaResult = { hash: result.hash };
    }

    const [creative] = await db.insert(schema.creatives).values({
      name,
      type: isVideo ? "video" : "image",
      source: "local",
      metaImageHash: metaResult.hash,
      metaVideoId: metaResult.videoId,
      fileSize: buffer.length,
      tags: tags ? JSON.parse(tags) : [],
    }).returning();

    return NextResponse.json(creative);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload creative" },
      { status: 500 }
    );
  }
}
