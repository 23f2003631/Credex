import { formatCurrency } from "@/lib/utils/format";

export interface AffectedAuditEmailSummary {
  slug: string;
  companyName?: string;
  historicalSavings: number;
  liveSavings: number;
  savingsDelta: number;
  explanation: string;
  changedTools: string[];
}

export function renderReAuditNotificationEmailHtml(
  email: string,
  affectedAudits: AffectedAuditEmailSummary[]
): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const pluralSuffix = affectedAudits.length > 1 ? "s" : "";
  const subject = `AI Spend Alert: Pricing updates affect your StackTrim audit${pluralSuffix}`;

  const auditsListHtml = affectedAudits
    .map((audit) => {
      const reAuditUrl = `${siteUrl}/share/${audit.slug}/diff`;
      const companyLabel = audit.companyName ? ` for ${audit.companyName}` : "";
      const deltaSign = audit.savingsDelta >= 0 ? "+" : "";
      const deltaColor = audit.savingsDelta >= 0 ? "#16a34a" : "#dc2626";

      return `
        <div style="border: 1px solid #e5e5e5; border-radius: 8px; padding: 20px; margin-bottom: 20px; background-color: #ffffff;">
          <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 16px; color: #171717; font-weight: 600;">
            Audit Report ${audit.slug}${companyLabel}
          </h3>
          <p style="margin: 0 0 16px 0; font-size: 14px; color: #525252; line-height: 1.5;">
            ${audit.explanation}
          </p>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
            <tr>
              <td style="font-size: 12px; color: #737373; text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 4px; width: 33.33%;">Old Savings</td>
              <td style="font-size: 12px; color: #737373; text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 4px; width: 33.33%;">New Savings</td>
              <td style="font-size: 12px; color: #737373; text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 4px; width: 33.33%;">Savings Delta</td>
            </tr>
            <tr>
              <td style="font-size: 16px; font-weight: 600; color: #171717; padding-bottom: 8px;">${formatCurrency(audit.historicalSavings)}<span style="font-size:11px;color:#737373;">/mo</span></td>
              <td style="font-size: 16px; font-weight: 600; color: #171717; padding-bottom: 8px;">${formatCurrency(audit.liveSavings)}<span style="font-size:11px;color:#737373;">/mo</span></td>
              <td style="font-size: 16px; font-weight: 600; color: ${deltaColor}; padding-bottom: 8px;">${deltaSign}${formatCurrency(audit.savingsDelta)}<span style="font-size:11px;">/mo</span></td>
            </tr>
          </table>
          <div style="font-size: 13px; color: #737373; margin-bottom: 16px;">
            <strong>Affected tools:</strong> ${audit.changedTools.map(t => t.toUpperCase()).join(", ")}
          </div>
          <div style="margin-top: 12px;">
            <a href="${reAuditUrl}" style="display: inline-block; background-color: #171717; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 13px;">
              View Side-by-Side Comparison →
            </a>
          </div>
        </div>
      `;
    })
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #171717;
      background-color: #f9fafb;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      overflow: hidden;
    }
    .header {
      padding: 24px 32px;
      border-bottom: 1px solid #e5e5e5;
      background-color: #ffffff;
    }
    .header h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: #171717;
    }
    .content {
      padding: 32px;
      background-color: #fafafa;
    }
    .footer {
      padding: 24px 32px;
      background-color: #f9fafb;
      border-top: 1px solid #e5e5e5;
      font-size: 12px;
      color: #737373;
    }
    .footer p {
      margin: 0 0 8px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>StackTrim Spend Alert</h1>
    </div>
    <div class="content">
      <p style="margin-top: 0; font-size: 14px; color: #171717;">Hello,</p>
      <p style="font-size: 14px; color: #171717; margin-bottom: 24px;">
        Vendor prices or plan structures have updated in our AI tool catalog since your previous spend audits were performed. 
        We re-evaluated your stack configurations and identified that your savings potential or plan optimization strategies have changed.
      </p>
      
      ${auditsListHtml}
      
      <p style="font-size: 14px; color: #171717; margin-top: 24px;">
        Click the buttons above to review the side-by-side comparative diffs, which outline exactly what changed in the pricing catalog and why.
      </p>
      <p style="font-size: 14px; color: #171717;">
        Best,<br>The StackTrim Operations Team
      </p>
    </div>
    <div class="footer">
      <p><strong>Methodology:</strong> Savings calculations are strictly deterministic and mathematically audited. AI is never used to determine pricing or calculations.</p>
      <p>This is a transactional operational notification based on your past lead submissions on StackTrim.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
