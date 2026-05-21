import type {
  AuditInput,
  AuditResult,
  Recommendation,
  ToolEntry,
  CalculationBreakdown,
} from "@/lib/types/audit";
import type { ToolCatalogEntry } from "@/lib/types/catalog";
import { getToolById } from "@/lib/engine/catalog";
import { pricingCatalog } from "@/lib/engine/catalog";
import {
  excessSeats,
  excessSeatSavings,
  downgradeSavings,
  isSignificantSavings,
  monthlyToAnnual,
  savingsPercentage as calcSavingsPercentage,
  consolidationSavings,
  rightsizingFormula,
  downgradeFormula,
  consolidationFormula,
  findOverlappingTools,
  roundCurrency,
} from "@/lib/engine/calculations";
import {
  scoreConfidence,
  rightsizingConfidence,
  downgradeConfidence,
  consolidationConfidence,
  creditConfidence,
  isPricingFresh,
  degradeConfidenceForMismatch,
} from "@/lib/engine/confidence";
import {
  computeExpectedSpend,
  computeDeviation,
  classifyMismatchSeverity,
  isCustomContractLikely,
  capSavingsPotential,
} from "@/lib/engine/pricing";
import {
  runOptimizationPipeline,
  clampSavings,
} from "@/lib/engine/pipeline";
import {
  classifySavingsRealism,
  calculateOptimizableSeats,
  isFreeTierRealistic,
} from "@/lib/engine/realism";

function generateAuditId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `audit_${timestamp}_${random}`;
}

export function analyzeToolSpend(
  entry: ToolEntry,
  teamSize: number,
  catalogEntry: ToolCatalogEntry,
  context?: EngineContext
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const pricingFresh = isPricingFresh(catalogEntry.lastVerified);

  const currentPlan = catalogEntry.plans.find((p) => p.id === entry.planTier);
  const planPrice = currentPlan ? currentPlan.monthlyPricePerSeat : 0;

  const expectedSpend = computeExpectedSpend(planPrice, entry.seats);
  const actualSpend = entry.monthlySpend;
  const deviation = computeDeviation(actualSpend, expectedSpend);
  const severity = classifyMismatchSeverity(deviation);
  const customContract = isCustomContractLikely(severity);

  const consistency: Recommendation["pricingConsistency"] = {
    expectedSpend,
    actualSpend,
    deviationPercentage: deviation * 100,
    severity,
    customContractLikely: customContract,
  };

  if (entry.seats > teamSize && currentPlan && planPrice > 0) {
    const excess = excessSeats(entry.seats, teamSize);

    excessSeatSavings(entry.seats, teamSize, planPrice);

    const expectedOptimizedSpend = computeExpectedSpend(planPrice, teamSize);
    const monthlySavings = capSavingsPotential(actualSpend, expectedSpend, expectedOptimizedSpend, severity);

    if (monthlySavings > 0) {
      const baseConfidence = scoreConfidence(rightsizingConfidence(pricingFresh)).level;
      const confidence = degradeConfidenceForMismatch(baseConfidence, severity);
        const calculation: CalculationBreakdown = {
          currentPlanName: currentPlan.name,
          recommendedPlanName: currentPlan.name,
          currentPricePerSeat: planPrice,
          recommendedPricePerSeat: planPrice,
          seatCount: excess,
          recommendedPlanId: currentPlan.id,
          formula: rightsizingFormula(excess, planPrice, monthlySavings),
        };

        const realisticSeats = calculateOptimizableSeats(entry.seats, teamSize, severity === "extreme");
        const seatsToRemove = entry.seats - realisticSeats;
        const realisticSavings = roundCurrency(seatsToRemove * planPrice);

        const signals = [
          `Detected ${entry.seats} seats for team of ${teamSize}`,
          `High seat-to-spend ratio (${entry.seats} units)`,
        ];
        if (severity !== "none") signals.push(`Pricing mismatch detected (${severity})`);

        const narrative = seatsToRemove < excess
          ? `Some seats may not require active licenses. Conservative right-sizing could reduce your allocation by ${seatsToRemove} seat${seatsToRemove > 1 ? "s" : ""}, saving ~$${realisticSavings}/mo while maintaining operational buffer.`
          : `You have ${entry.seats} seats but a team of ${teamSize}. Removing ${excess} excess seat${excess > 1 ? "s" : ""} at $${planPrice}/seat saves ~ $${roundCurrency(monthlySavings)}/mo.`;

        recommendations.push({
          type: "rightsize",
          toolId: entry.toolId,
          toolName: catalogEntry.name,
          currentSpend: actualSpend,
          recommendedSpend: roundCurrency(actualSpend - realisticSavings),
          monthlySavings: realisticSavings,
          annualSavings: monthlyToAnnual(realisticSavings),
          recommendedSeats: realisticSeats,
          reasoning: narrative,
          reasoningDetails: {
            narrative,
            detectedSignals: signals,
            usageAssumptions: ["Assumes 20-40% organizational overhead for seat allocation"],
            confidenceFactors: [
              pricingFresh ? "Fresh catalog pricing" : "Stale catalog pricing",
              severity === "none" ? "Consistent with public pricing" : "Custom pricing mismatch reduces certainty",
            ],
          },
          assumptions: {
            assumesPartialSeatReduction: seatsToRemove < excess,
            assumesMigrationFeasible: true,
          },
          confidence,
          calculation,
          pricingConsistency: consistency,
        });
      }
    }


  const currentPlanIndex = catalogEntry.plans.findIndex(
    (p) => p.id === entry.planTier
  );
  if (currentPlanIndex > 0) {
    const cheaperPlan = catalogEntry.plans[currentPlanIndex - 1];
    if (currentPlan) {
      const isFreeTier = cheaperPlan.monthlyPricePerSeat === 0;
      const isRealistic = !isFreeTier || isFreeTierRealistic(teamSize, entry.toolId);

      const catalogPotentialSavings = downgradeSavings(
        currentPlan.monthlyPricePerSeat,
        cheaperPlan.monthlyPricePerSeat,
        entry.seats
      );

      const expectedOptimizedSpend = computeExpectedSpend(cheaperPlan.monthlyPricePerSeat, entry.seats);
      const potentialSavings = capSavingsPotential(actualSpend, expectedSpend, expectedOptimizedSpend, severity);
      const currentCost = roundCurrency(planPrice * entry.seats);

      if (potentialSavings > 0 && isSignificantSavings(catalogPotentialSavings, currentCost)) {
        const baseConfidence = scoreConfidence(
          downgradeConfidence(pricingFresh, isRealistic)
        ).level;

        const confidence = isRealistic
          ? degradeConfidenceForMismatch(baseConfidence, severity)
          : "low";

        const calculation: CalculationBreakdown = {
          currentPlanName: currentPlan.name,
          recommendedPlanName: cheaperPlan.name,
          currentPricePerSeat: currentPlan.monthlyPricePerSeat,
          recommendedPricePerSeat: cheaperPlan.monthlyPricePerSeat,
          seatCount: entry.seats,
          recommendedPlanId: cheaperPlan.id,
          formula: downgradeFormula(
            entry.seats,
            planPrice,
            cheaperPlan.monthlyPricePerSeat,
            potentialSavings
          ),
        };

        const narrative = isFreeTier
          ? `Some seats may not require premium functionality. Evaluating usage patterns may support a partial move to the free tier for non-admin users.`
          : `Usage patterns may support the "${cheaperPlan.name}" tier ($${cheaperPlan.monthlyPricePerSeat}/seat) over your current "${currentPlan.name}" plan. Significant features should be audited before migration.`;

        const signals = [
          `Enterprise-tier features may be underutilized for a team of ${teamSize}`,
          `Public pricing suggests lower-cost alternatives for similar seat counts`,
        ];

        recommendations.push({
          type: "downgrade",
          toolId: entry.toolId,
          toolName: catalogEntry.name,
          currentSpend: actualSpend,
          recommendedSpend: roundCurrency(actualSpend - potentialSavings),
          monthlySavings: roundCurrency(potentialSavings),
          annualSavings: monthlyToAnnual(roundCurrency(potentialSavings)),
          recommendedSeats: entry.seats,
          reasoning: narrative,
          reasoningDetails: {
            narrative,
            detectedSignals: signals,
            pricingAnalysis: [
              `Plan Price: $${cheaperPlan.monthlyPricePerSeat}/seat`,
              `Current Price: $${planPrice}/seat`,
            ],
            usageAssumptions: [
              isFreeTier ? "Assumes basic usage patterns for subset of team" : "Assumes feature parity for current workflow",
              "Assumes minimal organizational resistance to plan changes",
            ],
            confidenceFactors: [
              isRealistic ? "Standard organizational migration" : "High friction: Downgrade to Free tier requires audit",
              severity === "none" ? "Aligned with public catalog" : "Custom pricing reduces prediction certainty",
            ],
          },
          assumptions: {
            assumesFeatureRedundancy: true,
            assumesLowEnterpriseDependency: teamSize < 20,
            assumesMigrationFeasible: isRealistic,
          },
          confidence,
          calculation,
          pricingConsistency: consistency,
        });
      }
    }
  }

  if (catalogEntry.hasStartupCredits && catalogEntry.creditNotes) {
    const confidence = scoreConfidence(creditConfidence());
    recommendations.push({
      type: "credit",
      toolId: entry.toolId,
      toolName: catalogEntry.name,
      currentSpend: actualSpend,
      recommendedSpend: actualSpend,
      monthlySavings: 0,
      annualSavings: 0,
      recommendedSeats: entry.seats,
      reasoning: catalogEntry.creditNotes,
      reasoningDetails: {
        narrative: catalogEntry.creditNotes,
        detectedSignals: ["Vendor offers official startup credit program"],
        usageAssumptions: ["Assumes company meets vendor's startup eligibility criteria"],
        confidenceFactors: ["Publicly advertised vendor program"],
      },
      confidence: confidence.level,
      pricingConsistency: consistency,
    });
  }

  return recommendations;
}

export function analyzeToolOverlaps(
  entries: ToolEntry[],
  resolveToolEntry: (toolId: string) => ToolCatalogEntry | undefined
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  const toolsWithCategories = entries
    .map((entry) => {
      const catalog = resolveToolEntry(entry.toolId);
      return catalog ? { toolId: entry.toolId, category: catalog.category, entry, catalog } : null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const overlaps = findOverlappingTools(toolsWithCategories);

  for (const [, toolIds] of overlaps) {
    if (toolIds.length < 2) continue;

    const overlappingTools = toolsWithCategories.filter((t) =>
      toolIds.includes(t.toolId)
    );

    overlappingTools.sort((a, b) => b.entry.monthlySpend - a.entry.monthlySpend);

    const keepTool = overlappingTools[0];
    for (let i = 1; i < overlappingTools.length; i++) {
      const dropTool = overlappingTools[i];
      const savings = consolidationSavings(
        keepTool.entry.monthlySpend,
        dropTool.entry.monthlySpend
      );

      if (savings <= 0) continue;

      const confidence = scoreConfidence(
        consolidationConfidence(isPricingFresh(dropTool.catalog.lastVerified))
      );

      recommendations.push({
        type: "consolidate",
        toolId: dropTool.toolId,
        toolName: dropTool.catalog.name,
        currentSpend: dropTool.entry.monthlySpend,
        recommendedSpend: 0,
        monthlySavings: savings,
        annualSavings: monthlyToAnnual(savings),
        recommendedSeats: 0,
        reasoning: `Operational redundancy detected between ${keepTool.catalog.name} and ${dropTool.catalog.name}. Consolidation potential identified.`,
        reasoningDetails: {
          narrative: `You have multiple tools (${keepTool.catalog.name} and ${dropTool.catalog.name}) serving the ${keepTool.category} category. Consolidation into a single platform can reduce license sprawl and simplify your stack.`,
          detectedSignals: [
            `Overlapping functionality in ${keepTool.category}`,
            `Duplicate subscription for ${dropTool.catalog.name}`,
          ],
          usageAssumptions: [
            "Assumes feature parity between platforms",
            "Assumes data migration between tools is feasible",
          ],
          confidenceFactors: [
            "Deterministic category overlap",
            "Functional redundancy identified",
          ],
        },
        assumptions: {
          assumesFeatureRedundancy: true,
          assumesMigrationFeasible: false,
        },
        confidence: confidence.level,
        calculation: {
          currentPlanName: dropTool.catalog.name,
          recommendedPlanName: keepTool.catalog.name,
          currentPricePerSeat: 0,
          recommendedPricePerSeat: 0,
          seatCount: dropTool.entry.seats,
          formula: consolidationFormula(dropTool.catalog.name, savings),
        },
      });
    }
  }

  return recommendations;
}

function generateKeepRecommendations(
  entries: ToolEntry[],
  existingRecToolIds: Set<string>,
  context?: EngineContext
): Recommendation[] {
  const keeps: Recommendation[] = [];

  for (const entry of entries) {
    if (existingRecToolIds.has(entry.toolId)) continue;

    const catalogEntry = getToolById(entry.toolId, context);
    if (!catalogEntry) continue;

    const currentPlanIndex = catalogEntry.plans.findIndex(
      (p) => p.id === entry.planTier
    );

    const isLowestTier = currentPlanIndex <= 0;
    const hasExcessSeats = entry.seats > 0;

    if (isLowestTier || !hasExcessSeats) {
      keeps.push({
        type: "keep",
        toolId: entry.toolId,
        toolName: catalogEntry.name,
        currentSpend: entry.monthlySpend,
        recommendedSpend: entry.monthlySpend,
        monthlySavings: 0,
        annualSavings: 0,
        reasoning: isLowestTier
          ? `Already on the lowest available plan ("${catalogEntry.plans[currentPlanIndex]?.name ?? "Free"}"). No downgrade available.`
          : `Current plan appears well-sized for your team. No changes recommended.`,
        confidence: "high",
      });
    }
  }

  return keeps;
}

import type { EngineContext } from "@/lib/engine/catalog";

export function generateAuditResult(input: AuditInput, context?: EngineContext): AuditResult {
  const auditId = generateAuditId();
  const currentCatalogVersion = context?.catalog?.version || pricingCatalog.version;

  const {
    recommendations: savingsRecs,
    toolStates,
    optimizationOrder
  } = runOptimizationPipeline(input, context);

  const allRecommendations: Recommendation[] = [...savingsRecs];

  const recsWithSavings = new Set(savingsRecs.map(r => r.toolId));
  const keepRecs = generateKeepRecommendations(input.tools, recsWithSavings, context);
  allRecommendations.push(...keepRecs);

  for (const toolEntry of input.tools) {
    const catalogEntry = getToolById(toolEntry.toolId, context);
    if (catalogEntry?.hasStartupCredits && catalogEntry.creditNotes) {
      const state = toolStates[toolEntry.toolId];
      allRecommendations.push({
        type: "credit",
        toolId: toolEntry.toolId,
        toolName: catalogEntry.name,
        currentSpend: state.currentSpend,
        recommendedSpend: state.currentSpend,
        monthlySavings: 0,
        annualSavings: 0,
        reasoning: catalogEntry.creditNotes,
        confidence: "medium",
        pricingConsistency: {
          expectedSpend: state.currentSpend,
          actualSpend: state.currentSpend,
          deviationPercentage: 0,
          severity: "none",
          customContractLikely: false,
        }
      });
    }
  }

  allRecommendations.sort((a, b) => {
    if (a.monthlySavings !== b.monthlySavings) {
      return b.monthlySavings - a.monthlySavings;
    }
    const typeWeight = { consolidate: 0, downgrade: 1, rightsize: 2, credit: 3, keep: 4 } as Record<string, number>;
    return (typeWeight[a.type] ?? 5) - (typeWeight[b.type] ?? 5);
  });

  allRecommendations.forEach((rec, index) => {
    rec.priority = index + 1;
    rec.catalogVersion = currentCatalogVersion;
  });

  const totalMonthlySpend = input.tools.reduce((sum, t) => sum + t.monthlySpend, 0);

  const finalOptimizedSpend = Object.values(toolStates).reduce((sum, s) => sum + s.currentSpend, 0);
  let totalMonthlySavings = totalMonthlySpend - finalOptimizedSpend;

  totalMonthlySavings = clampSavings(totalMonthlySavings, totalMonthlySpend);

  const totalAnnualSavings = monthlyToAnnual(totalMonthlySavings);
  const usedManualOverride = input.tools.some((t) => t.isManualOverride);

  const savingsPercentage = calcSavingsPercentage(totalMonthlySavings, totalMonthlySpend);
  const savingsRealismLevel = classifySavingsRealism(savingsPercentage);

  const severityLevels = { none: 0, low: 1, medium: 2, high: 3, extreme: 4 };
  let maxMismatchSeverity: import("@/lib/types/audit").PricingMismatchSeverity = "none";
  for (const rec of allRecommendations) {
    if (rec.pricingConsistency?.severity) {
      const currentLevel = severityLevels[rec.pricingConsistency.severity];
      const maxLevel = severityLevels[maxMismatchSeverity];
      if (currentLevel > maxLevel) {
        maxMismatchSeverity = rec.pricingConsistency.severity;
      }
    }
  }

  const aggregateAssumptions: import("@/lib/types/audit").OptimizationAssumptions = {
    assumesPartialSeatReduction: allRecommendations.some(r => r.assumptions?.assumesPartialSeatReduction),
    assumesFeatureRedundancy: allRecommendations.some(r => r.assumptions?.assumesFeatureRedundancy),
    assumesLowEnterpriseDependency: allRecommendations.some(r => r.assumptions?.assumesLowEnterpriseDependency),
    assumesMigrationFeasible: allRecommendations.every(r => r.assumptions?.assumesMigrationFeasible !== false),
  };

  return {
    id: auditId,
    input,
    recommendations: allRecommendations,
    totalMonthlySpend: roundCurrency(totalMonthlySpend),
    totalMonthlySavings: roundCurrency(totalMonthlySavings),
    totalAnnualSavings,
    savingsPercentage,
    createdAt: new Date().toISOString(),
    catalogVersion: currentCatalogVersion,
    hasOverlappingTools: allRecommendations.some(r => r.type === "consolidate"),
    optimizedToolCount: keepRecs.length,
    usedManualOverride,
    maxMismatchSeverity,
    optimizationOrder,
    toolStates,
    savingsRealismLevel,
    aggregateAssumptions,
  };
}
