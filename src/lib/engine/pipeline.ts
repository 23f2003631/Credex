import type {
  AuditInput,
  Recommendation,
  ToolEntry,
  OptimizedToolState,
  RecommendationType
} from "@/lib/types/audit";
import { getToolById } from "@/lib/engine/catalog";
import type { EngineContext } from "@/lib/engine/catalog";
import {
  analyzeToolSpend,
  analyzeToolOverlaps
} from "@/lib/engine/analyzer";

export function initializeToolStates(input: AuditInput, context?: EngineContext): Record<string, OptimizedToolState> {
  const states: Record<string, OptimizedToolState> = {};

  for (const entry of input.tools) {
    const catalog = getToolById(entry.toolId, context);
    states[entry.toolId] = {
      toolId: entry.toolId,
      toolName: catalog?.name || entry.toolId,
      originalPlan: entry.planTier,
      originalSeats: entry.seats,
      originalSpend: entry.monthlySpend,
      currentPlan: entry.planTier,
      currentSeats: entry.seats,
      currentSpend: entry.monthlySpend,
      appliedRecommendationIds: [],
    };
  }

  return states;
}

export function analyzeCurrentState(
  state: OptimizedToolState,
  teamSize: number,
  typeFilter: RecommendationType,
  context?: EngineContext
): Recommendation[] {
  const catalogEntry = getToolById(state.toolId, context);
  if (!catalogEntry) return [];

  const currentEntry: ToolEntry = {
    toolId: state.toolId,
    planTier: state.currentPlan,
    monthlySpend: state.currentSpend,
    seats: state.currentSeats,
    useCases: [],
  };

  const allRecs = analyzeToolSpend(currentEntry, teamSize, catalogEntry, context);
  return allRecs.filter(r => r.type === typeFilter);
}

export function runOptimizationPipeline(input: AuditInput, context?: EngineContext): {
  recommendations: Recommendation[];
  toolStates: Record<string, OptimizedToolState>;
  optimizationOrder: string[];
} {
  const toolStates = initializeToolStates(input, context);
  const recommendations: Recommendation[] = [];
  const optimizationOrder: string[] = [];

  const consolidationCandidates = analyzeToolOverlaps(input.tools, (toolId) => getToolById(toolId, context));
  for (const rec of consolidationCandidates) {
    const state = toolStates[rec.toolId];
    if (!state || state.currentSpend === 0) continue;

    const preSpend = state.currentSpend;
    state.currentSpend = 0;
    state.currentSeats = 0;
    state.appliedRecommendationIds.push(`${rec.type}_${rec.toolId}`);

    recommendations.push({
      ...rec,
      preOptimizationSpend: preSpend,
      postOptimizationSpend: 0,
      modifies: "tool",
    });
    optimizationOrder.push(rec.toolId);
  }

  for (const toolId in toolStates) {
    const state = toolStates[toolId];
    if (state.currentSpend === 0) continue;

    const downgradeRecs = analyzeCurrentState(state, input.teamSize, "downgrade", context);
    if (downgradeRecs.length > 0) {
      const rec = downgradeRecs[0];
      const preSpend = state.currentSpend;

      state.currentPlan = rec.calculation?.recommendedPlanId || state.currentPlan;
      state.currentSpend = rec.recommendedSpend;
      state.appliedRecommendationIds.push(`${rec.type}_${rec.toolId}`);

      recommendations.push({
        ...rec,
        preOptimizationSpend: preSpend,
        postOptimizationSpend: state.currentSpend,
        modifies: "plan",
      });
      optimizationOrder.push(rec.toolId);
    }
  }

  for (const toolId in toolStates) {
    const state = toolStates[toolId];
    if (state.currentSpend === 0) continue;

    const rightsizeRecs = analyzeCurrentState(state, input.teamSize, "rightsize", context);
    if (rightsizeRecs.length > 0) {
      const rec = rightsizeRecs[0];
      const preSpend = state.currentSpend;

      const wasDowngraded = state.appliedRecommendationIds.some(id => id.startsWith("downgrade"));
      const contextualNote = wasDowngraded
        ? "Assumes previous plan optimization"
        : undefined;

      state.currentSeats = rec.recommendedSeats ?? state.currentSeats;
      state.currentSpend = rec.recommendedSpend;
      state.appliedRecommendationIds.push(`${rec.type}_${rec.toolId}`);

      recommendations.push({
        ...rec,
        preOptimizationSpend: preSpend,
        postOptimizationSpend: state.currentSpend,
        contextualNote,
        modifies: "seats",
      });
      optimizationOrder.push(rec.toolId);
    }
  }

  return { recommendations, toolStates, optimizationOrder };
}

export function clampSavings(totalSavings: number, totalSpend: number): number {
  return Math.max(0, Math.min(totalSavings, totalSpend));
}
