-- StackTrim Migration 002: Add Re-audit Columns
-- Execute this migration in your Supabase SQL Editor if you wish to expose dedicated columns.
-- Note: StackTrim's backend code is resilient and falls back to using the JSONB metadata column 
-- to support zero-downtime rolling deploys without requiring immediate database lockups.

-- Add user_email to audits table for direct mapping
ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS user_email TEXT;
CREATE INDEX IF NOT EXISTS idx_audits_user_email ON public.audits(user_email);

-- Add pricing_snapshot to audits table for storing the optimized historical catalog state
ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB;

-- Add comment to explain backward-compatibility logic
COMMENT ON COLUMN public.audits.user_email IS 'Direct cache of the user work email associated with this audit. Syncs from leads.';
COMMENT ON COLUMN public.audits.pricing_snapshot IS 'Optimized snapshot of the audited tools and plan pricing at the time of calculation.';
