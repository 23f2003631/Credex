# Development Log: Round-2 Spend Re-Audit Feature

This log documents the step-by-step engineering timeline and design iterations taken to build and harden the Re-Audit spend comparison system.

---

## Timeline & Chronological Phases

### Phase 1: Engine Codebase Research
- **Actions**: Audited `pipeline.ts`, `catalog.ts`, and `analyzer.ts` to identify catalog lookup dependencies.
- **Insights**:
  - Found that the catalog was imported statically as `pricingCatalog` in many locations.
  - To support re-auditing historically, we must inject a custom `EngineContext` carrying the reconstructed historic catalog.
  - Refactored `pipeline.ts` and `analyzer.ts` to cleanly accept and propagate an optional `EngineContext`.

### Phase 2: Snapshots & Lead Persistence
- **Actions**:
  - Modified `src/app/api/audit/route.ts` to generate a minimized snapshot of tools and plans used in the current audit, persisting it both in the `pricing_snapshot` column and inside the `metadata.pricingSnapshot` block.
  - Updated `src/app/api/lead/route.ts` to write captured user emails to both `user_email` and `metadata.userEmail`.
- **Reasoning**: This double-write schema strategy ensures that even if database migrations are in a pending state, the core application will not encounter data insertion issues.

### Phase 3: Change Detection Implementation
- **Actions**:
  - Created `src/lib/config/reaudit.ts` containing the `$5.00/mo` threshold, annual `$60.00/yr` limit, batch delay, and lock timeout configurations.
  - Built `src/lib/engine/change-detection.ts` implementing `reconstructCatalogFromSnapshot` and `detectAuditChanges`.
- **Reasoning**: Minimized snapshots store only `name` and `monthlyPricePerSeat` for specific plans to conserve database space. The reconstruction utility handles fallback properties (e.g., categories, vendor) dynamically from the live active catalog.

### Phase 4: Serverless API Endpoint & Email Notifications
- **Actions**:
  - Built `/api/detect-changes` endpoint with DB-backed concurrency lock to prevent parallel lambda executions.
  - Designed the transactional HTML template `re-audit-notification.ts` supporting Vercel/Linear-style glassmorphism formatting.
  - Added Resend API integration with batch throttling delay to avoid API rate limiting.
- **Debug Insights**:
  - Caught an edge-case where parallel execution in a serverless environment could trigger multiple concurrent runs. Resolved this by introducing a database locking record (`slug: 'job-lock-metadata'`) with a `5-minute` auto-unlock timeout.

### Phase 5: Side-by-Side Comparison UI
- **Actions**:
  - Developed the server component page at `src/app/share/[slug]/diff/page.tsx` that fetches snapshots and computes comparative historical/live audits on the fly.
  - Coded `src/components/audit/diff-results.tsx` supporting:
    - Side-by-side comparison tables.
    - Large impact numbers showing savings delta.
    - Muted/collapsed unchanged tools.
    - Glassmorphism verified trust banners.
    - State badges showing: "Savings Increased", "Recommendation Updated", "Review Suggested", and "Optimal & Verified".

### Phase 6: TypeScript Compiling & QA Hardening
- **Actions**:
  - Created Vitest regression test suite at `src/tests/engine/reaudit.test.ts`.
  - Ran `npx tsc --noEmit` which identified three compiler issues in `src/app/api/detect-changes/route.ts`:
    1. Implicit `any` type for the audit filtering parameter. (Fixed by adding explicit `: any` casting).
    2. Invalid signature usage of `logger.error` which expects 1-2 arguments, but received 3. (Fixed by merging context payloads).
    3. `unknown` type error on caught errors inside catch block. (Fixed by checking instance types and extracting stack/messages).
  - Re-ran type checker and verified 0 compiler errors.
  - Ran complete Vitest suite: All 188/188 tests passed cleanly.

---

## Verbatim Test Output
```
 RUN  v4.1.5 E:/Credex

 ✓ src/tests/security/abuse.test.ts (4 tests) 4ms
 ✓ src/tests/engine/snapshot.test.ts (13 tests) 11ms
 ✓ src/tests/engine/calculations.test.ts (38 tests) 14ms
 ✓ src/tests/engine/realism.test.ts (9 tests) 7ms
 ✓ src/tests/engine/catalog.test.ts (29 tests) 19ms
 ✓ src/tests/engine/og-metadata.test.ts (11 tests) 58ms
 ✓ src/tests/engine/format.test.ts (4 tests) 61ms
 ✓ src/tests/engine/print-format.test.ts (10 tests) 92ms
 ✓ src/tests/engine/pipeline.test.ts (3 tests) 9ms
 ✓ src/tests/engine/analyzer.test.ts (28 tests) 22ms
 ✓ src/tests/engine/confidence.test.ts (18 tests) 10ms
 ✓ src/tests/engine/pricing.test.ts (11 tests) 5ms
 ✓ src/tests/config/flags.test.ts (1 test) 3ms
 ✓ src/tests/engine/reaudit.test.ts (7 tests) 6ms
 ✓ src/tests/ai/summary.test.ts (2 tests) 6ms

 Test Files  15 passed (15)
      Tests  188 passed (188)
   Start at  15:20:58
   Duration  4.70s 
```
