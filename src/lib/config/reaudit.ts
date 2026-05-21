/**
 * Re-audit System Configuration
 *
 * Configurable thresholds and rates to prevent spamming users
 * with negligible differences and optimize Resend API dispatch.
 */
export const reauditConfig = {
  thresholds: {
    /** Minimum savings difference ($/mo) required to alert the user */
    minimumMonthlyDelta: 5.0,
    /** Minimum annual savings difference ($/yr) */
    minimumAnnualDelta: 60.0,
  },
  notifications: {
    /** delay between consecutive Resend API email dispatches to prevent rate limit hits */
    batchDelayMs: 200,
  },
  security: {
    /** Lock timeout in milliseconds (5 minutes) */
    lockTimeoutMs: 300000,
  }
} as const;
