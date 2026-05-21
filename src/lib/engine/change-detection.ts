import type { PricingCatalog, ToolCatalogEntry } from "@/lib/types/catalog";
import type { AuditResult } from "@/lib/types/audit";
import { pricingCatalog as activeCatalog } from "./catalog";
import { reauditConfig } from "@/lib/config/reaudit";

export interface ChangeDetectionResult {
  hasChanges: boolean;
  hasSignificantSavingsDelta: boolean;
  hasRecommendationChange: boolean;
  savingsDelta: number;
  annualSavingsDelta: number;
  changedTools: string[];
  historicalSavings: number;
  liveSavings: number;
  explanation: string;
}

/**
 * Safely reconstructs a full historical PricingCatalog from a stored lightweight snapshot.
 * Fallbacks to activeCatalog for missing or unresolvable details.
 */
export function reconstructCatalogFromSnapshot(snapshot: any): PricingCatalog {
  if (!snapshot || !snapshot.tools) {
    return activeCatalog;
  }

  const tools: ToolCatalogEntry[] = [];
  for (const toolId in snapshot.tools) {
    const sTool = snapshot.tools[toolId];
    const currentTool = activeCatalog.tools.find((t) => t.id === toolId);

    // Reconstruct plans with snapshot values, fallback to active values
    const plans = currentTool
      ? currentTool.plans.map((p) => {
          const sPlan = sTool.plans?.[p.id];
          return {
            ...p,
            monthlyPricePerSeat: sPlan !== undefined ? sPlan.monthlyPricePerSeat : p.monthlyPricePerSeat,
          };
        })
      : Object.entries(sTool.plans || {}).map(([planId, planData]: [string, any]) => ({
          id: planId,
          name: planData.name || planId,
          monthlyPricePerSeat: planData.monthlyPricePerSeat ?? 0,
          features: [],
        }));

    tools.push({
      id: toolId,
      name: sTool.name || (currentTool?.name ?? toolId),
      category: currentTool?.category ?? "ai-assistant",
      pricingModel: currentTool?.pricingModel ?? "per-seat",
      pricingUrl: currentTool?.pricingUrl ?? "",
      lastVerified: snapshot.lastUpdated || "",
      plans,
      vendor: currentTool?.vendor,
      hasStartupCredits: currentTool?.hasStartupCredits,
      creditNotes: currentTool?.creditNotes,
      alternatives: currentTool?.alternatives,
    });
  }

  // Copy any other tools from current catalog to ensure complete categories
  for (const currentTool of activeCatalog.tools) {
    if (!tools.some((t) => t.id === currentTool.id)) {
      tools.push(currentTool);
    }
  }

  return {
    version: snapshot.pricingVersion || activeCatalog.version,
    lastUpdated: snapshot.lastUpdated || activeCatalog.lastUpdated,
    tools,
  };
}

/**
 * Computes the delta between historical and live audit results, validating changes
 * against significance thresholds.
 */
export function detectAuditChanges(
  historicalResult: AuditResult,
  liveResult: AuditResult
): ChangeDetectionResult {
  const historicalSavings = historicalResult.totalMonthlySavings;
  const liveSavings = liveResult.totalMonthlySavings;
  const savingsDelta = liveSavings - historicalSavings;
  const annualSavingsDelta = savingsDelta * 12;

  const hasSignificantSavingsDelta =
    Math.abs(savingsDelta) >= reauditConfig.thresholds.minimumMonthlyDelta;

  let hasRecommendationChange = false;
  const changedTools: string[] = [];

  const historicalRecs = historicalResult.recommendations.filter(
    (r) => r.type !== "keep" && r.type !== "credit"
  );
  const liveRecs = liveResult.recommendations.filter(
    (r) => r.type !== "keep" && r.type !== "credit"
  );

  // Map tool ID to recommended plan selection
  const histMap = new Map<string, string>();
  for (const r of historicalRecs) {
    histMap.set(r.toolId, `${r.type}:${r.calculation?.recommendedPlanId || ""}`);
  }

  const liveMap = new Map<string, string>();
  for (const r of liveRecs) {
    liveMap.set(r.toolId, `${r.type}:${r.calculation?.recommendedPlanId || ""}`);
  }

  // Detect differences
  const allToolIds = new Set([...histMap.keys(), ...liveMap.keys()]);
  for (const toolId of allToolIds) {
    const histVal = histMap.get(toolId);
    const liveVal = liveMap.get(toolId);
    if (histVal !== liveVal) {
      hasRecommendationChange = true;
      changedTools.push(toolId);
    }
  }

  const hasChanges = hasSignificantSavingsDelta || hasRecommendationChange;

  let explanation = "";
  if (hasChanges) {
    if (hasSignificantSavingsDelta && hasRecommendationChange) {
      explanation = `Recommendation strategy changed, leading to an additional savings shift of $${Math.abs(
        savingsDelta
      ).toFixed(2)}/mo.`;
    } else if (hasSignificantSavingsDelta) {
      explanation = `Pricing updates resulted in a net savings change of $${savingsDelta.toFixed(
        2
      )}/mo ($${annualSavingsDelta.toFixed(2)}/yr).`;
    } else {
      explanation = `Optimized plans or tools updated, although net savings remain similar.`;
    }
  } else {
    explanation = "No meaningful pricing or recommendation changes detected.";
  }

  return {
    hasChanges,
    hasSignificantSavingsDelta,
    hasRecommendationChange,
    savingsDelta,
    annualSavingsDelta,
    changedTools,
    historicalSavings,
    liveSavings,
    explanation,
  };
}
