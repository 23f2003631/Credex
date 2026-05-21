# Architectural & Engineering Reflections: Round-2 Spend Re-Audit

## 1. Technical Trade-Offs & Decisions

### Minimized Snapshot vs. Heavyweight Catalog Serialization
* **Trade-Off**: Serializing the entire pricing catalog (500+ lines, multiple schemas) into every audit database row would cause substantial storage bloat, making query execution and database indexing sluggish.
* **Decision**: We designed a minimized snapshot that captures only the specific tools, plans, and rates actually present in the user's audit request.
* **Benefits**: Conserves database space, loads lightweight records in milliseconds, and retains all critical variables needed to perfectly reconstruct catalog contexts on the fly. Fallback properties are dynamically resolved from the live catalog during calculations.

### Serverless Concurrency Guard (Metadata Row vs. Redis Locks)
* **Trade-Off**: Serverless functions (Next.js Lambdas) operate statelessly. In-memory locks (like JS Sets or Mutexes) do not persist across concurrent executions, which could easily cause multiple parallel catalog change detectors to run and spam customers.
* **Decision**: Utilizing an administrative DB lock metadata row (`slug: 'job-lock-metadata'`) was preferred over adding an external Redis dependency.
* **Benefits**: Ensures zero additional infrastructure costs, utilizes existing Supabase infrastructure, protects execution concurrency, and handles crash recoverability seamlessly using a 5-minute lock expiration timeout.

### Resilient Double-Write Strategy
* **Trade-Off**: In active production settings, database migrations are high-risk operations. A locked table or pending migration could cause immediate service disruptions.
* **Decision**: All persisted entries (user email and pricing snapshots) are written concurrently to both dedicated database columns and inside the existing schema's JSONB block (`metadata`).
* **Benefits**: Complete zero-downtime tolerance. The application works flawlessly regardless of whether migrations have been fully executed or are currently deferred.

---

## 2. Security & Compliance Review

### PII Leakage Protection
* The public snapshot creation utility (`createPublicSnapshot`) acts as a strict security barrier, stripping all sensitive data fields (user emails, company names, private notes) and leaving only anonymous tool counts, names, and aggregated savings figures.
* In the side-by-side re-audit comparison dashboard, all calculations are executed using isolated deterministic pipelines, guaranteeing that no raw input notes or user email data is ever sent to client browsers.

### Safe Admin Endpoints
* The `/api/detect-changes` route is shielded behind strict Bearer token authentication matching the `ADMIN_SECRET` environment key. It also supports `dryRun` parameters, enabling engineers and administrators to diagnose catalog revisions safely in staging/production with zero side effects.

---

## 3. Scalability & Future Growth

1. **Database Partitioning**: As database audits exceed $10^5$ entries, filtering the table on `/api/detect-changes` should be shifted from complete table reads to indexing records containing `user_email` with index markers like `lastNotificationTimestamp`.
2. **Cron Queue Architecture**: Currently, email dispatches are sequential with a `200ms` rate-limiting batch throttle. While optimal for hundreds of audits, scaling to tens of thousands of users will require decoupling the change detector from the notification worker using queue databases (e.g., Vercel KV/Upstash QStash, or Celery workers).
3. **Historical Catalog Archiving**: While minimized snapshots are highly effective, a complete historical log of catalog versions should be stored in a centralized `pricing_catalog_history` table to allow comprehensive pricing history analytics.
