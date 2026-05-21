import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { generateAuditResult } from "@/lib/engine/analyzer";
import { reconstructCatalogFromSnapshot, detectAuditChanges } from "@/lib/engine/change-detection";
import { sendReAuditNotificationEmail } from "@/lib/email/resend";
import type { AffectedAuditEmailSummary } from "@/lib/email/templates/re-audit-notification";
import { reauditConfig } from "@/lib/config/reaudit";
import { logger } from "@/lib/observability/logger";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "stacktrim-admin-secret-dev";

export async function POST(req: Request) {
  let isLockAcquired = false;
  const supabase = createAdminClient();

  try {
    // 1. Authorization Check
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.substring(7);
    if (token !== ADMIN_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse query params for dryRun diagnostics
    const { searchParams } = new URL(req.url);
    const dryRun = searchParams.get("dryRun") === "true";

    // 2. Serverless Concurrency Lock
    // Fetch or create lock record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data: lockRecord, error: lockFetchError } = await (supabase.from("audits") as any)
      .select("id, metadata")
      .eq("slug", "job-lock-metadata")
      .maybeSingle();

    if (lockFetchError) {
      logger.error("Failed to query job lock record", { error: lockFetchError });
      return NextResponse.json({ error: "Lock check failed" }, { status: 500 });
    }

    if (!lockRecord) {
      // Create lock record if missing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newLock, error: lockInsertError } = await (supabase.from("audits") as any)
        .insert({
          slug: "job-lock-metadata",
          input_data: { tools: [] },
          result_data: {},
          public_snapshot: { metadata: {} },
          catalog_version: "lock",
          engine_version: "1.0.0",
          total_monthly_savings: 0,
          total_annual_savings: 0,
          metadata: {
            active: false,
            updatedAt: new Date(0).toISOString(),
          },
        })
        .select("id, metadata")
        .single();

      if (lockInsertError) {
        logger.error("Failed to initialize job lock", { error: lockInsertError });
        return NextResponse.json({ error: "Lock init failed" }, { status: 500 });
      }
      lockRecord = newLock;
    }

    const now = new Date();
    const updatedAt = lockRecord.metadata?.updatedAt ? new Date(lockRecord.metadata.updatedAt) : new Date(0);
    const lockAgeMs = now.getTime() - updatedAt.getTime();
    const isLocked = lockRecord.metadata?.active === true && lockAgeMs < reauditConfig.security.lockTimeoutMs;

    if (isLocked) {
      logger.warn("Parallel execution blocked by DB lock", { lockAgeMs });
      return NextResponse.json({ error: "Another job is currently running." }, { status: 409 });
    }

    // Acquire lock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: lockAcquireError } = await (supabase.from("audits") as any)
      .update({
        metadata: {
          active: true,
          updatedAt: now.toISOString(),
        },
      })
      .eq("slug", "job-lock-metadata");

    if (lockAcquireError) {
      logger.error("Failed to acquire lock", { error: lockAcquireError });
      return NextResponse.json({ error: "Failed to acquire lock" }, { status: 500 });
    }
    isLockAcquired = true;

    // 3. Change Detection Run
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: audits, error: auditsFetchError } = await (supabase.from("audits") as any)
      .select("*")
      .not("slug", "eq", "job-lock-metadata");

    if (auditsFetchError) {
      logger.error("Failed to fetch audits", { error: auditsFetchError });
      throw auditsFetchError;
    }

    const eligibleAudits = (audits || []).filter(
      (a: any) => a.user_email || a.metadata?.userEmail
    );

    const affectedByUser: Record<
      string,
      {
        summary: AffectedAuditEmailSummary[];
        auditsToUpdate: Array<{ id: string; metadata: any; delta: number; isRecChange: boolean }>;
      }
    > = {};

    let totalChecked = eligibleAudits.length;

    for (const audit of eligibleAudits) {
      const email = audit.user_email || audit.metadata?.userEmail;
      if (!email) continue;

      const rawSnapshot = audit.pricing_snapshot || audit.metadata?.pricingSnapshot;
      if (!rawSnapshot) {
        logger.warn("Skipping audit due to missing pricing snapshot", { slug: audit.slug });
        continue;
      }

      try {
        const snapshot = typeof rawSnapshot === "string" ? JSON.parse(rawSnapshot) : rawSnapshot;
        const historicalCatalog = reconstructCatalogFromSnapshot(snapshot);

        // Run isolated calculations
        const historicalResult = generateAuditResult(audit.input_data, { catalog: historicalCatalog });
        const liveResult = generateAuditResult(audit.input_data); // live context defaults to activeCatalog

        const changes = detectAuditChanges(historicalResult, liveResult);

        if (changes.hasChanges) {
          if (!affectedByUser[email]) {
            affectedByUser[email] = { summary: [], auditsToUpdate: [] };
          }

          affectedByUser[email].summary.push({
            slug: audit.slug,
            companyName: audit.input_data?.companyName,
            historicalSavings: changes.historicalSavings,
            liveSavings: changes.liveSavings,
            savingsDelta: changes.savingsDelta,
            explanation: changes.explanation,
            changedTools: changes.changedTools,
          });

          affectedByUser[email].auditsToUpdate.push({
            id: audit.id,
            metadata: audit.metadata,
            delta: changes.savingsDelta,
            isRecChange: changes.hasRecommendationChange,
          });
        }
      } catch (err) {
        logger.error(`Error checking audit diff: ${err instanceof Error ? err.message : String(err)}`, { slug: audit.slug });
      }
    }

    const executionSummary = {
      dryRun,
      totalAuditsChecked: totalChecked,
      affectedUsersCount: Object.keys(affectedByUser).length,
      affectedAuditsCount: Object.values(affectedByUser).reduce((sum, u) => sum + u.summary.length, 0),
      reports: {} as Record<string, AffectedAuditEmailSummary[]>,
      emailDispatches: [] as Array<{ email: string; success: boolean; id?: string; error?: string }>,
    };

    for (const [email, data] of Object.entries(affectedByUser)) {
      executionSummary.reports[email] = data.summary;
    }

    // 4. consolidated Notification Dispatch
    if (!dryRun && executionSummary.affectedUsersCount > 0) {
      for (const [email, data] of Object.entries(affectedByUser)) {
        logger.info("Dispatching consolidated notification", { to: email, count: data.summary.length });

        const emailResult = await sendReAuditNotificationEmail(email, data.summary);

        executionSummary.emailDispatches.push({
          email,
          success: emailResult.success,
          id: emailResult.id,
          error: emailResult.error,
        });

        if (emailResult.success) {
          // Update audits with multi-audit observability metadata markers
          for (const item of data.auditsToUpdate) {
            const reason = item.isRecChange ? "recommendation_change" : "savings_threshold";
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from("audits") as any)
              .update({
                metadata: {
                  ...(item.metadata || {}),
                  lastNotificationTimestamp: new Date().toISOString(),
                  lastNotificationReason: reason,
                  lastNotificationDelta: item.delta,
                },
              })
              .eq("id", item.id);
          }
        }

        // Batch throttling delay
        if (reauditConfig.notifications.batchDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, reauditConfig.notifications.batchDelayMs));
        }
      }
    }

    logger.metric("Change detection run completed successfully", {
      dryRun,
      checked: totalChecked,
      affected: executionSummary.affectedAuditsCount,
    });

    return NextResponse.json(executionSummary, { status: 200 });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : "Unknown fatal error";
    logger.error("Fatal error during change detection run", { error: error instanceof Error ? error.stack || error.message : String(error) });
    return NextResponse.json({ error: errMessage }, { status: 500 });
  } finally {
    // 5. Release Concurrency Lock
    if (isLockAcquired) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("audits") as any)
        .update({
          metadata: {
            active: false,
            updatedAt: new Date().toISOString(),
          },
        })
        .eq("slug", "job-lock-metadata");
    }
  }
}
