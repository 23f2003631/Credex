"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ArrowLeftRight,
  ShieldCheck,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils/format";
import type { AuditResult, Recommendation } from "@/lib/types/audit";
import type { ChangeDetectionResult } from "@/lib/engine/change-detection";

interface ReAuditDiffResultsProps {
  historicalResult: AuditResult;
  liveResult: AuditResult;
  changeResult: ChangeDetectionResult;
  slug: string;
}

const TYPE_LABELS: Record<string, string> = {
  downgrade: "Downgrade",
  consolidate: "Consolidate",
  credit: "Credit Opportunity",
  eliminate: "Eliminate",
  rightsize: "Rightsize",
  keep: "Optimized",
  "switch-vendor": "Switch Vendor",
  "review-api-usage": "Review API",
};

const TYPE_COLORS: Record<string, string> = {
  downgrade: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50",
  consolidate: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50",
  credit: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/50",
  eliminate: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50",
  rightsize: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50",
  keep: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800",
  "switch-vendor": "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900/50",
  "review-api-usage": "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-900/50",
};

export function ReAuditDiffResults({
  historicalResult,
  liveResult,
  changeResult,
  slug,
}: ReAuditDiffResultsProps) {
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [isUnchangedExpanded, setIsUnchangedExpanded] = useState(false);

  const toggleTool = (toolId: string) => {
    setExpandedTools((prev) => ({ ...prev, [toolId]: !prev[toolId] }));
  };

  const getStatusBadge = () => {
    if (!changeResult.hasChanges) {
      return (
        <Badge variant="outline" className="bg-slate-50/50 text-slate-700 border-slate-200 px-3 py-1 text-xs font-semibold gap-1.5 dark:bg-slate-900/50 dark:text-slate-300 dark:border-slate-800">
          <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
          Optimal & Verified
        </Badge>
      );
    }
    if (changeResult.savingsDelta > 0 && changeResult.hasSignificantSavingsDelta) {
      return (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 px-3 py-1 text-xs font-semibold gap-1.5 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
          Savings Increased
        </Badge>
      );
    }
    if (changeResult.hasRecommendationChange) {
      return (
        <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 px-3 py-1 text-xs font-semibold gap-1.5 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900/50">
          <Sparkles className="h-3.5 w-3.5 text-violet-600" />
          Recommendation Updated
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 px-3 py-1 text-xs font-semibold gap-1.5 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50">
        <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
        Review Suggested
      </Badge>
    );
  };

  // Group tools into changed vs unchanged
  const changedTools: { toolId: string; histRec: Recommendation; liveRec: Recommendation }[] = [];
  const unchangedTools: { toolId: string; histRec: Recommendation; liveRec: Recommendation }[] = [];

  for (const histRec of historicalResult.recommendations) {
    const liveRec = liveResult.recommendations.find((r) => r.toolId === histRec.toolId);
    if (!liveRec) continue;

    const isChanged = changeResult.changedTools.includes(histRec.toolId);
    if (isChanged) {
      changedTools.push({ toolId: histRec.toolId, histRec, liveRec });
    } else {
      unchangedTools.push({ toolId: histRec.toolId, histRec, liveRec });
    }
  }

  // Handle new tools in live audit that were not present in historical
  for (const liveRec of liveResult.recommendations) {
    const histRec = historicalResult.recommendations.find((r) => r.toolId === liveRec.toolId);
    if (!histRec) {
      // Re-create a mock historical 'keep' recommendation since it wasn't audited initially
      const mockHist: Recommendation = {
        type: "keep",
        toolId: liveRec.toolId,
        toolName: liveRec.toolName,
        currentSpend: liveRec.currentSpend,
        recommendedSpend: liveRec.currentSpend,
        monthlySavings: 0,
        annualSavings: 0,
        reasoning: "Not included in historical audit snapshot.",
        confidence: "high",
        calculation: {
          currentPlanName: liveRec.calculation?.currentPlanName || "Standard",
          recommendedPlanName: liveRec.calculation?.currentPlanName || "Standard",
          currentPricePerSeat: liveRec.calculation?.currentPricePerSeat || 0,
          recommendedPricePerSeat: liveRec.calculation?.currentPricePerSeat || 0,
          seatCount: liveRec.calculation?.seatCount || 0,
          formula: "",
        },
      };
      changedTools.push({ toolId: liveRec.toolId, histRec: mockHist, liveRec });
    }
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* 1. Header & Quick Back Link */}
      <div className="flex items-center justify-between">
        <Link
          href={`/share/${slug}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors group"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180 transition-transform group-hover:-translate-x-0.5" />
          Back to Share Dashboard
        </Link>
        <span className="text-[10px] font-mono text-muted-foreground bg-secondary/80 px-2 py-1 rounded border border-border/40">
          CATALOG VERSION: {liveResult.catalogVersion}
        </span>
      </div>

      {/* 2. Visual Top Impact Card */}
      <Card className="relative overflow-hidden border-2 border-border/80 shadow-lg bg-gradient-to-br from-card to-secondary/30">
        <CardContent className="p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1.5">
              {getStatusBadge()}
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Re-Audit spend Comparison
              </h1>
              <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
                {changeResult.hasChanges
                  ? `StackTrim detected catalog pricing modifications since your original audit on ${new Date(
                      historicalResult.createdAt
                    ).toLocaleDateString()}. Here is a comparison of your potential savings.`
                  : "We ran a live re-audit against our latest catalog pricing structures. Your tool setup remains fully optimized with zero action required."}
              </p>
            </div>
            
            {/* Impact Metric display */}
            <div className="shrink-0 bg-secondary/70 border border-border/60 p-4 rounded-xl flex flex-col justify-center min-w-[200px] text-center shadow-inner">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Savings Shift
              </span>
              <span
                className={`text-3xl font-black tracking-tighter ${
                  changeResult.savingsDelta > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : changeResult.savingsDelta < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-foreground/80"
                }`}
              >
                {changeResult.savingsDelta > 0 ? "+" : ""}
                {formatCurrency(changeResult.savingsDelta)}
                <span className="text-xs font-semibold text-muted-foreground ml-1">/mo</span>
              </span>
              <span className="text-xs text-muted-foreground mt-1">
                {changeResult.savingsDelta > 0 ? "Additional " : changeResult.savingsDelta < 0 ? "Reduced " : ""}
                ({formatCurrency(changeResult.annualSavingsDelta)}/yr impact)
              </span>
            </div>
          </div>

          <Separator className="bg-border/60" />

          {/* Side by Side Comparative Totals */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Original Monthly Savings</span>
              <p className="text-xl font-bold">{formatCurrency(changeResult.historicalSavings)}/mo</p>
            </div>
            <div className="space-y-1 sm:border-l sm:border-border/60 sm:pl-6">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live Monthly Savings
              </span>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(changeResult.liveSavings)}/mo
              </p>
            </div>
            <div className="space-y-1 sm:border-l sm:border-border/60 sm:pl-6">
              <span className="text-xs text-muted-foreground">Current Monthly Spend</span>
              <p className="text-xl font-bold">{formatCurrency(liveResult.totalMonthlySpend)}/mo</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Reassuring Trust Screen for optimal setup */}
      {!changeResult.hasChanges && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-emerald-500/20 bg-emerald-50/10 p-8 text-center space-y-4 shadow-sm dark:bg-emerald-950/5"
        >
          <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto">
            <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-bold text-emerald-900 dark:text-emerald-300">
              Your AI Stack is perfectly optimized
            </h3>
            <p className="text-sm text-emerald-800/80 dark:text-emerald-400/80 leading-relaxed">
              No catalog revisions affect your recommendations. We re-verified all tier boundaries, seat counts, and discount programs. You are still on the absolute most cost-efficient configuration.
            </p>
          </div>
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Last Verified: {new Date(liveResult.createdAt).toLocaleString()}
            </span>
            <span className="hidden sm:inline">•</span>
            <span>Deterministic Math: 100% verified accuracy</span>
          </div>
          <div className="pt-2">
            <Link
              href={`/share/${slug}`}
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              Go to original Audit Report
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </motion.div>
      )}

      {/* 4. Changed Tool Recommendations */}
      {changedTools.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <span>Changed Recommendations</span>
              <Badge variant="secondary" className="font-mono text-xs px-2 py-0">
                {changedTools.length}
              </Badge>
            </h2>
            <span className="text-xs text-muted-foreground">Detailed old vs. new plan diffs</span>
          </div>

          <div className="space-y-4">
            {changedTools.map(({ toolId, histRec, liveRec }) => {
              const isOpen = expandedTools[toolId] !== false; // open by default for changed tools
              const planChanged = histRec.calculation?.recommendedPlanId !== liveRec.calculation?.recommendedPlanId;
              const savingsChanged = Math.abs(histRec.monthlySavings - liveRec.monthlySavings) >= 0.01;

              return (
                <Card
                  key={toolId}
                  className={`overflow-hidden border transition-all duration-200 ${
                    isOpen ? "border-foreground/20 shadow-md" : "border-border/60 hover:border-foreground/10"
                  }`}
                >
                  {/* Tool Header */}
                  <div
                    onClick={() => toggleTool(toolId)}
                    className="flex items-center justify-between p-4 bg-secondary/20 cursor-pointer select-none hover:bg-secondary/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-foreground/5 font-bold text-xs uppercase border border-border/40">
                        {liveRec.toolName.slice(0, 2)}
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-foreground">{liveRec.toolName}</h3>
                        <p className="text-xs text-muted-foreground">
                          {liveRec.calculation?.seatCount} seats input • Original Spend: {formatCurrency(liveRec.currentSpend)}/mo
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {planChanged && (
                          <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-100 text-[10px] py-0 px-1.5 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900/50">
                            Plan Shift
                          </Badge>
                        )}
                        {savingsChanged && (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-100 text-[10px] py-0 px-1.5 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50">
                            Savings Delta
                          </Badge>
                        )}
                      </div>
                      <button className="text-muted-foreground hover:text-foreground">
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Tool Body Comparison */}
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CardContent className="p-5 border-t border-border/40 space-y-6">
                          {/* Reasoning changes */}
                          <div className="space-y-1">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recommendation Strategy</span>
                            <p className="text-xs leading-relaxed text-muted-foreground">{liveRec.reasoning}</p>
                          </div>

                          {/* Side-by-Side Table Columns */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                            {/* Left: Historical */}
                            <div className="rounded-xl border border-border/50 bg-secondary/10 p-4 space-y-3 relative overflow-hidden">
                              <div className="absolute top-0 right-0 p-2 text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest bg-secondary px-2 py-0.5 rounded-bl border-l border-b border-border/30">
                                Previous Audit
                              </div>
                              <div className="space-y-1 pt-1">
                                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Recommended Plan</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold">{histRec.calculation?.recommendedPlanName}</span>
                                  <span className={`inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-semibold ${TYPE_COLORS[histRec.type]}`}>
                                    {TYPE_LABELS[histRec.type]}
                                  </span>
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Seat Price</span>
                                  <p className="text-xs font-semibold">{formatCurrency(histRec.calculation?.recommendedPricePerSeat || 0)}/mo</p>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Savings</span>
                                  <p className="text-xs font-bold text-muted-foreground">{formatCurrency(histRec.monthlySavings)}/mo</p>
                                </div>
                              </div>
                            </div>

                            {/* Right: Live */}
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/5 p-4 space-y-3 relative overflow-hidden dark:bg-emerald-950/5">
                              <div className="absolute top-0 right-0 p-2 text-[10px] font-mono text-emerald-600 uppercase tracking-widest bg-emerald-50/50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-bl border-l border-b border-emerald-500/10">
                                Live Audit
                              </div>
                              <div className="space-y-1 pt-1">
                                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Recommended Plan</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-emerald-950 dark:text-emerald-300">
                                    {liveRec.calculation?.recommendedPlanName}
                                  </span>
                                  <span className={`inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-semibold ${TYPE_COLORS[liveRec.type]}`}>
                                    {TYPE_LABELS[liveRec.type]}
                                  </span>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Seat Price</span>
                                  <p className="text-xs font-semibold text-emerald-950 dark:text-emerald-300">
                                    {formatCurrency(liveRec.calculation?.recommendedPricePerSeat || 0)}/mo
                                  </p>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Savings</span>
                                  <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                                    {formatCurrency(liveRec.monthlySavings)}/mo
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Quick details delta summary */}
                          {savingsChanged && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary/30 px-3 py-2 rounded border border-border/40">
                              <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
                              <span>
                                Savings shift for {liveRec.toolName}:{" "}
                                <strong className={liveRec.monthlySavings - histRec.monthlySavings > 0 ? "text-emerald-600" : "text-rose-600"}>
                                  {liveRec.monthlySavings - histRec.monthlySavings > 0 ? "+" : ""}
                                  {formatCurrency(liveRec.monthlySavings - histRec.monthlySavings)}/mo
                                </strong>{" "}
                                difference compared to previous catalog constraints.
                              </span>
                            </div>
                          )}
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. Unchanged Tool Recommendations (Collapsible Accordion Group) */}
      {unchangedTools.length > 0 && (
        <Card className="border border-border/40 overflow-hidden bg-secondary/5">
          <div
            onClick={() => setIsUnchangedExpanded(!isUnchangedExpanded)}
            className="flex items-center justify-between p-4 cursor-pointer select-none hover:bg-secondary/20 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Unchanged Tool Recommendations ({unchangedTools.length})
              </span>
            </div>
            <button className="text-muted-foreground">
              {isUnchangedExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          <AnimatePresence>
            {isUnchangedExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="border-t border-border/30 divide-y divide-border/20 bg-background"
              >
                {unchangedTools.map(({ toolId, histRec, liveRec }) => (
                  <div key={toolId} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-foreground">{liveRec.toolName}</span>
                      <span className="text-muted-foreground ml-2">
                        • recommended: {liveRec.calculation?.recommendedPlanName} (
                        {formatCurrency(liveRec.calculation?.recommendedPricePerSeat || 0)}/seat)
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">
                        Savings: <strong>{formatCurrency(liveRec.monthlySavings)}/mo</strong>
                      </span>
                      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.2 text-[10px] font-medium text-slate-600 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400">
                        Stable
                      </span>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}

      {/* 6. Detailed Methodology Disclosure */}
      <Card className="border border-border/40 bg-secondary/10">
        <CardContent className="p-4 space-y-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <strong>Methodology & Safety Disclaimer:</strong> All live re-audits are 100% deterministic, evaluating exact plan boundaries, seat counts, and rulesets against our verified public catalog dataset (catalog version {liveResult.catalogVersion}, engine version 1.0.0). Calculations contain zero generative AI hallucinations or heuristic estimates.
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <strong>Observation Snapshot:</strong> The previous audit comparison reflects pricing recorded at catalog version {historicalResult.catalogVersion}. Historical data is reconstructed strictly from the lightweight snapshot persisted during user submission.
          </p>
        </CardContent>
      </Card>

      {/* 7. Beautiful Interactive CTAs */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
        <Link
          href={`/share/${slug}`}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-foreground text-background px-6 py-2 text-sm font-bold shadow transition-colors hover:bg-foreground/90 w-full sm:w-auto"
        >
          View Full Live Audit Report
        </Link>
        <Link
          href="/audit"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-6 py-2 text-sm font-semibold hover:bg-secondary transition-colors w-full sm:w-auto"
        >
          Audit a New Stack
        </Link>
      </div>
    </div>
  );
}
