import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { generateAuditResult } from "@/lib/engine/analyzer";
import { reconstructCatalogFromSnapshot, detectAuditChanges } from "@/lib/engine/change-detection";
import { ReAuditDiffResults } from "@/components/audit/diff-results";
import { Shield } from "lucide-react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from("audits") as any)
    .select("input_data")
    .eq("slug", slug)
    .single();

  if (!data) {
    return {
      title: "Re-Audit Spend Comparison — StackTrim",
    };
  }

  const company = data.input_data?.companyName || "Your Team";
  return {
    title: `${company} — Re-Audit Spend Comparison — StackTrim`,
    description: `Compare historical pricing vs. live updated pricing structures for your AI SaaS tool stack. Powered by StackTrim's deterministic optimization engine.`,
  };
}

export default async function ReAuditDiffPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("audits") as any)
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !data) {
    notFound();
  }

  const rawSnapshot = data.pricing_snapshot || data.metadata?.pricingSnapshot;
  if (!rawSnapshot) {
    // If no snapshot exists, return 404 to avoid layout errors
    notFound();
  }

  let historicalCatalog;
  try {
    const snapshot = typeof rawSnapshot === "string" ? JSON.parse(rawSnapshot) : rawSnapshot;
    historicalCatalog = reconstructCatalogFromSnapshot(snapshot);
  } catch {
    historicalCatalog = reconstructCatalogFromSnapshot(null);
  }

  // Generate historical result (reconstructed snapshot context)
  const historicalResult = generateAuditResult(data.input_data, { catalog: historicalCatalog });

  // Generate live result (activeCatalog)
  const liveResult = generateAuditResult(data.input_data);

  // Compute changes
  const changeResult = detectAuditChanges(historicalResult, liveResult);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-foreground selection:text-background">
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground">
              <span className="text-xs font-bold text-background">ST</span>
            </div>
            <span className="text-sm font-semibold tracking-tight">
              StackTrim
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Live Re-Audit
            </span>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-8 sm:py-12">
          <ReAuditDiffResults
            historicalResult={historicalResult}
            liveResult={liveResult}
            changeResult={changeResult}
            slug={slug}
          />
        </div>
      </main>

      <footer className="border-t border-border/40 py-6 mt-12 bg-secondary/5">
        <div className="mx-auto max-w-5xl px-6">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            <span>StackTrim Re-Audit comparison. Powered by deterministic optimization pricing snapshots.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
