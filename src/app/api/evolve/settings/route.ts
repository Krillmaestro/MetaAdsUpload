import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { getEvolveSettings } from "@/lib/evolve/settings";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const settings = await getEvolveSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const current = await getEvolveSettings();

    const values = {
      targetRoas: body.targetRoas ?? current.targetRoas,
      holdRoas: body.holdRoas ?? current.holdRoas,
      breakevenRoas: body.breakevenRoas ?? current.breakevenRoas,
      targetCpa: body.targetCpa ?? current.targetCpa,
      minDailySpend: body.minDailySpend ?? current.minDailySpend,
      sekPerUsd: body.sekPerUsd ?? current.sekPerUsd,
      bonusTiers: body.bonusTiers !== undefined ? body.bonusTiers : current.bonusTiers,
      learningPeriodDays: body.learningPeriodDays ?? current.learningPeriodDays,
      scalingProtocolDays: body.scalingProtocolDays ?? current.scalingProtocolDays,
      zombieCostCapDiscount: body.zombieCostCapDiscount ?? current.zombieCostCapDiscount,
      maxAdSetsPerCampaign: body.maxAdSetsPerCampaign ?? current.maxAdSetsPerCampaign,
      surfModeEnabled: body.surfModeCampaignIds !== undefined
        ? body.surfModeCampaignIds.length > 0
        : body.surfModeEnabled ?? current.surfModeEnabled,
      surfModeCampaignIds: body.surfModeCampaignIds !== undefined
        ? JSON.stringify(body.surfModeCampaignIds)
        : (current.surfModeCampaignIds ? JSON.stringify(current.surfModeCampaignIds) : null),
      surfIntervalHours: body.surfIntervalHours ?? current.surfIntervalHours,
      graveyardCampaignId: body.graveyardCampaignId !== undefined ? body.graveyardCampaignId : current.graveyardCampaignId,
      graveyardMappings: body.graveyardMappings !== undefined
        ? JSON.stringify(body.graveyardMappings)
        : (current.graveyardMappings ? JSON.stringify(current.graveyardMappings) : null),
      updatedAt: new Date(),
    };

    if (current.id) {
      await db
        .update(schema.evolveSettings)
        .set(values)
        .where(eq(schema.evolveSettings.id, current.id));
    } else {
      await db.insert(schema.evolveSettings).values(values);
    }

    const updated = await getEvolveSettings();
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save settings" },
      { status: 500 }
    );
  }
}
