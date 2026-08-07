/**
 * One-off pre-warm for the insights persistent cache (lib/insights-store.ts).
 * Fetches and stores the last N "final" days (older than the settling
 * window) for every account across all configured Meta tokens, so the first
 * real dashboard request for a wide range (this_month/last_month/last_30d)
 * doesn't have to pay that cost itself.
 *
 * Safe to re-run — days already marked synced are skipped.
 *
 * Run locally with:
 *   BACKFILL_DAYS=90 npm run backfill-insights
 * (reads META_ACCESS_TOKEN(_2/_3) and POSTGRES_URL from .env.local automatically)
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { fetchAdNames } from "../lib/meta";
import { dedupeAccounts } from "../lib/dedupe";
import { splitDateRange, upsertAdNames } from "../lib/insights-store";
import { syncFinalDates } from "../lib/insights-sync";

const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS || 90);

async function main() {
  const tokens = [
    process.env.META_ACCESS_TOKEN,
    process.env.META_ACCESS_TOKEN_2,
    process.env.META_ACCESS_TOKEN_3,
  ].filter(Boolean) as string[];

  if (tokens.length === 0) {
    console.error("No META_ACCESS_TOKEN configured — set it in .env.local first.");
    process.exit(1);
  }
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL is not set — run `npm run migrate-insights-db` first (see README.md).");
    process.exit(1);
  }

  const asOf = new Date();
  const since = new Date(asOf.getTime() - BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10);
  const until = asOf.toISOString().slice(0, 10);
  console.log(`Backfilling ${BACKFILL_DAYS} days (${since}..${until}) across ${tokens.length} token(s)...`);

  for (const [tokenIndex, token] of tokens.entries()) {
    const { rows: adNames, accounts, failures: nameFailures } = await fetchAdNames(token);
    const accountList = dedupeAccounts(accounts);
    await upsertAdNames(adNames);
    console.log(`[token ${tokenIndex + 1}] ${accountList.length} accounts, ${adNames.length} ad names cached`);
    for (const f of nameFailures) console.warn(`[token ${tokenIndex + 1}] ad-name fetch failed for ${f.accountName || f.accountId}: ${f.message}`);

    const { finalDates } = splitDateRange(since, until, asOf);
    const failures = await syncFinalDates(token, accountList.map((a) => a.id), finalDates);
    if (failures.length === 0) {
      console.log(`[token ${tokenIndex + 1}] backfill complete, no failures`);
    } else {
      for (const f of failures) console.warn(`[token ${tokenIndex + 1}] backfill failed for ${f.accountName || f.accountId}: ${f.message}`);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
