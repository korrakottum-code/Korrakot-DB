export type TabKey = "branch" | "program" | "creative";

export interface GroupedRow {
  name: string;
  spend: number;
  impressions: number;
  inbox: number;
  cpi: number;
  depth3: number;
  pctDepth3: number;
  leads: number;
  cpl: number;
  // Optional comparison (previous period) fields
  prevSpend?: number;
  prevImpressions?: number;
  prevInbox?: number;
  prevCpi?: number;
  prevDepth3?: number;
  prevPctDepth3?: number;
  prevLeads?: number;
  prevCpl?: number;
}

