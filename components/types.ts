export type TabKey = "branch" | "program" | "creative";

export interface GroupedRow {
  name: string;
  spend: number;
  impressions: number;
  inbox: number;
  cpi: number;
  leads: number;
  cpl: number;
  // Optional comparison (previous period) fields
  prevSpend?: number;
  prevImpressions?: number;
  prevInbox?: number;
  prevCpi?: number;
  prevLeads?: number;
  prevCpl?: number;
}

