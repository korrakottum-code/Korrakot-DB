export type TabKey = "branch" | "program" | "creative";

export interface GroupedRow {
  name: string;
  spend: number;
  impressions: number;
  inbox: number;
  cpi: number;
  leads: number;
  cpl: number;
}
