export interface ReportExportMetadata {
  snapshotId: string;
  periodSince: string;
  periodUntil: string;
  comparisonSince: string;
  comparisonUntil: string;
  objective: string;
  timezone: string;
  asOf: string;
  generatedAt: string;
  coverage: string;
  confidence: string;
}

export interface ReportExportRow {
  name: string;
  spend: number;
  share: number;
  inbox: number;
  leads: number;
  cpi: number | null;
  cpl: number | null;
  decision?: string;
  confidence?: string;
}

export interface ReportExportDailyRow {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  inbox: number;
  leads: number;
}

export function createSnapshotId(input: {
  since: string;
  until: string;
  comparisonSince: string;
  comparisonUntil: string;
  fetchedAt: string;
}): string {
  const raw = [input.since, input.until, input.comparisonSince, input.comparisonUntil, input.fetchedAt].join("|");
  return `snapshot-${raw.replace(/[^a-zA-Z0-9|:-]/g, "-")}`;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

export function buildReportCsv(
  metadata: ReportExportMetadata,
  branches: ReportExportRow[],
  daily: ReportExportDailyRow[]
): string {
  const lines = [
    csvLine(["Report", "Management Report"]),
    csvLine(["Snapshot ID", metadata.snapshotId]),
    csvLine(["Period", `${metadata.periodSince} ถึง ${metadata.periodUntil}`]),
    csvLine(["Comparison", `${metadata.comparisonSince} ถึง ${metadata.comparisonUntil}`]),
    csvLine(["Objective", metadata.objective]),
    csvLine(["Timezone", metadata.timezone]),
    csvLine(["As of", metadata.asOf]),
    csvLine(["Generated at", metadata.generatedAt]),
    csvLine(["Coverage", metadata.coverage]),
    csvLine(["Confidence", metadata.confidence]),
    "",
    csvLine(["Branch scorecard"]),
    csvLine(["Name", "Spend", "Spend share", "Inbox", "Lead", "CPI", "CPL", "Decision", "Confidence"]),
    ...branches.map((row) => csvLine([row.name, row.spend, row.share, row.inbox, row.leads, row.cpi ?? "", row.cpl ?? "", row.decision || "", row.confidence || ""])),
    "",
    csvLine(["Daily trend"]),
    csvLine(["Date", "Spend", "Impressions", "Clicks", "Inbox", "Lead"]),
    ...daily.map((row) => csvLine([row.date, row.spend, row.impressions, row.clicks, row.inbox, row.leads])),
  ];
  return `\uFEFF${lines.join("\n")}\n`;
}
