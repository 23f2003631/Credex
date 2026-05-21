import { describe, it, expect } from "vitest";
import { reconstructCatalogFromSnapshot, detectAuditChanges } from "@/lib/engine/change-detection";
import { reauditConfig } from "@/lib/config/reaudit";
import type { AuditResult, Recommendation } from "@/lib/types/audit";

function createMockRecommendation(overrides?: Partial<Recommendation>): Recommendation {
  return {
    type: "keep",
    toolId: "cursor",
    toolName: "Cursor",
    currentSpend: 40,
    recommendedSpend: 40,
    monthlySavings: 0,
    annualSavings: 0,
    reasoning: "Already optimized.",
    confidence: "high",
    calculation: {
      currentPlanName: "Pro",
      recommendedPlanName: "Pro",
      recommendedPlanId: "pro",
      currentPricePerSeat: 20,
      recommendedPricePerSeat: 20,
      seatCount: 2,
      formula: "2 seats * $20/mo",
    },
    ...overrides,
  };
}

function createMockAuditResult(overrides?: Partial<AuditResult>): AuditResult {
  return {
    id: "test-audit-id",
    input: {
      companyName: "Acme Corp",
      email: "test@example.com",
      teamSize: 2,
      tools: [
        {
          toolId: "cursor",
          planTier: "pro",
          monthlySpend: 40,
          seats: 2,
          useCases: ["code"],
        },
      ],
    },
    recommendations: [createMockRecommendation()],
    totalMonthlySpend: 40,
    totalMonthlySavings: 0,
    totalAnnualSavings: 0,
    savingsPercentage: 0,
    createdAt: new Date().toISOString(),
    catalogVersion: "1.0",
    hasOverlappingTools: false,
    optimizedToolCount: 1,
    usedManualOverride: false,
    maxMismatchSeverity: "none",
    optimizationOrder: [],
    toolStates: {},
    savingsRealismLevel: "normal",
    aggregateAssumptions: {},
    ...overrides,
  };
}

describe("Re-audit System Tests", () => {
  describe("Catalog Reconstruction", () => {
    it("should fallback to activeCatalog if snapshot is missing", () => {
      const catalog = reconstructCatalogFromSnapshot(null);
      expect(catalog).toBeDefined();
      expect(catalog.tools.length).toBeGreaterThan(0);
    });

    it("should reconstruct tool and plans with values from snapshot", () => {
      const snapshot = {
        pricingVersion: "test-1.0",
        lastUpdated: "2026-05-20",
        tools: {
          cursor: {
            name: "Cursor AI",
            plans: {
              pro: {
                name: "Pro Tier",
                monthlyPricePerSeat: 25, // modified price
              },
            },
          },
        },
      };

      const catalog = reconstructCatalogFromSnapshot(snapshot);
      expect(catalog.version).toBe("test-1.0");
      
      const cursor = catalog.tools.find((t) => t.id === "cursor");
      expect(cursor).toBeDefined();
      expect(cursor?.name).toBe("Cursor AI");
      
      const proPlan = cursor?.plans.find((p) => p.id === "pro");
      expect(proPlan).toBeDefined();
      expect(proPlan?.monthlyPricePerSeat).toBe(25);
    });
  });

  describe("Change Detection Math & Thresholds", () => {
    it("should report no changes if historical and live are identical", () => {
      const hist = createMockAuditResult();
      const live = createMockAuditResult();
      const result = detectAuditChanges(hist, live);

      expect(result.hasChanges).toBe(false);
      expect(result.hasSignificantSavingsDelta).toBe(false);
      expect(result.hasRecommendationChange).toBe(false);
      expect(result.savingsDelta).toBe(0);
    });

    it("should detect changes if savings delta exceeds monthly threshold", () => {
      // Historical savings: $0
      const hist = createMockAuditResult({ totalMonthlySavings: 0 });
      // Live savings: $10/mo ($120/yr) -> exceeds $5 threshold
      const live = createMockAuditResult({ totalMonthlySavings: 10 });
      const result = detectAuditChanges(hist, live);

      expect(result.hasChanges).toBe(true);
      expect(result.hasSignificantSavingsDelta).toBe(true);
      expect(result.savingsDelta).toBe(10);
      expect(result.annualSavingsDelta).toBe(120);
    });

    it("should ignore changes below threshold if there is no recommendation change", () => {
      // Historical savings: $0
      const hist = createMockAuditResult({ totalMonthlySavings: 0 });
      // Live savings: $3/mo ($36/yr) -> below $5 threshold
      const live = createMockAuditResult({ totalMonthlySavings: 3 });
      const result = detectAuditChanges(hist, live);

      expect(result.hasChanges).toBe(false);
      expect(result.hasSignificantSavingsDelta).toBe(false);
      expect(result.savingsDelta).toBe(3);
    });

    it("should detect changes if recommendation plan changes, even if savings delta is small", () => {
      const histRec = createMockRecommendation({
        type: "downgrade",
        monthlySavings: 10,
        calculation: {
          currentPlanName: "Business",
          recommendedPlanName: "Pro",
          recommendedPlanId: "pro",
          currentPricePerSeat: 40,
          recommendedPricePerSeat: 20,
          seatCount: 2,
          formula: "",
        },
      });

      const liveRec = createMockRecommendation({
        type: "downgrade",
        monthlySavings: 12, // Savings delta is $2, below threshold
        calculation: {
          currentPlanName: "Business",
          recommendedPlanName: "Enterprise Mock",
          recommendedPlanId: "enterprise-mock", // plan id changed
          currentPricePerSeat: 40,
          recommendedPricePerSeat: 18,
          seatCount: 2,
          formula: "",
        },
      });

      const hist = createMockAuditResult({
        totalMonthlySavings: 10,
        recommendations: [histRec],
      });
      const live = createMockAuditResult({
        totalMonthlySavings: 12,
        recommendations: [liveRec],
      });

      const result = detectAuditChanges(hist, live);
      expect(result.hasChanges).toBe(true);
      expect(result.hasRecommendationChange).toBe(true);
      expect(result.hasSignificantSavingsDelta).toBe(false); // only $2
      expect(result.savingsDelta).toBe(2);
    });
  });

  describe("Configuration Limits", () => {
    it("should have correct threshold configuration values", () => {
      expect(reauditConfig.thresholds.minimumMonthlyDelta).toBe(5.0);
      expect(reauditConfig.thresholds.minimumAnnualDelta).toBe(60.0);
      expect(reauditConfig.security.lockTimeoutMs).toBe(300000);
    });
  });
});
