import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { sendAuditReportEmail } from "@/lib/email/resend";
import { PublicAuditSnapshot } from "@/lib/types/audit";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { isPayloadTooLarge, isHoneypotTriggered } from "@/lib/security/validation";
import { logger } from "@/lib/observability/logger";

const leadSchema = z.object({
  email: z.string().email(),
  companyName: z.string().optional(),
  role: z.string().optional(),
  consultationIntent: z.boolean().default(false),
  auditSlug: z.string(),
});

export async function POST(req: Request) {
  try {
    const contentLength = req.headers.get("content-length");
    if (isPayloadTooLarge(contentLength)) {
      logger.warn("Payload too large in lead capture", { contentLength });
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    if (!checkRateLimit(ip)) {
      logger.warn("Rate limit exceeded in lead capture", { ip });
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await req.json();

    if (isHoneypotTriggered(body)) {
      logger.info("Honeypot triggered in lead capture", { ip });
      return NextResponse.json({ success: true }, { status: 201 });
    }

    const parsed = leadSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("Invalid lead data", { error: parsed.error.format() });
      return NextResponse.json(
        { error: "Invalid lead data", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const leadData = parsed.data;
    const supabase = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: audit, error: auditError } = await (supabase.from("audits") as any)
      .select("id, public_snapshot, metadata")
      .eq("slug", leadData.auditSlug)
      .single();

    if (auditError || !audit) {
      return NextResponse.json(
        { error: "Invalid audit reference" },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dbError } = await (supabase.from("leads") as any).insert({
      email: leadData.email,
      company_name: leadData.companyName,
      consultation_intent: leadData.consultationIntent,
      audit_id: audit.id,
      metadata: {
        auditSlug: leadData.auditSlug,
      },
    });

    if (dbError) {
      logger.error("Failed to insert lead", { error: dbError });
      return NextResponse.json(
        { error: "Failed to process lead" },
        { status: 500 }
      );
    }

    // Update the corresponding audit to persist the user's email in both the user_email column
    // and the metadata JSONB block (resilient fallback).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: auditUpdateError } = await (supabase.from("audits") as any)
      .update({
        user_email: leadData.email,
        metadata: {
          ...(audit.metadata as Record<string, unknown> || {}),
          userEmail: leadData.email,
        },
      })
      .eq("id", audit.id);

    if (auditUpdateError) {
      logger.warn("Failed to update audit with user email, continuing", { error: auditUpdateError });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("events") as any).insert({
      event_type: "lead_captured",
      audit_id: audit.id,
      event_data: { consultationIntent: leadData.consultationIntent },
    });

    logger.metric("Lead captured successfully", { auditId: audit.id });

    const emailResult = await sendAuditReportEmail(
      leadData.email,
      leadData.auditSlug,
      audit.public_snapshot as unknown as PublicAuditSnapshot,
      (audit.metadata as Record<string, unknown>)?.aiSummary as string || null,
      leadData.companyName
    );

    if (!emailResult.success) {
      logger.warn("Lead saved, but email dispatch failed", { error: emailResult.error, email: leadData.email });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    logger.error("Lead API Error", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
