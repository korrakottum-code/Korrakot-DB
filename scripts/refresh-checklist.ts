/**
 * Weekly creative-checklist refresh.
 *
 * Fetches this week's Top-performing ads (lowest reliable CPI), scores each
 * one against the CURRENT checklist using the same OpenAI vision scorer used
 * in the product, then:
 *   1. Recomputes `passThreshold` from the real score distribution of Top ads
 *      (percentile-based), instead of a fixed guess — this directly fixes
 *      the "a real Top ad only scored 60% but still made Top" problem.
 *   2. Flags checklist items with a low pass-rate among Top ads for human
 *      review in the sourceNote (never auto-deletes criteria).
 *
 * This script only WRITES the local file — it does not commit or push.
 * Vercel's filesystem is read-only at runtime, so this must run in CI
 * (see .github/workflows/checklist-refresh.yml) which commits the result
 * and opens a Pull Request for human review, per the repo's Git workflow.
 *
 * Run locally with:
 *   OPENAI_API_KEY=... META_ACCESS_TOKEN=... npm run refresh-checklist
 */
import fs from "fs";
import path from "path";
import { fetchAllInsights, type AdInsight } from "../lib/meta";
import { fetchCreativeAssets, buildTokenByAccount } from "../lib/creative-assets";
import { hasReliableCost } from "../lib/metrics";
import { readChecklistConfig } from "../lib/creative-checklist-store";
import type { ChecklistConfig, MediaType } from "../lib/creative-checklist";
import { scoreChecklist } from "../lib/creative-checklist";
import { scoreImageAgainstChecklist, ChecklistAiError } from "../lib/creative-checklist-ai";
import { computeDataDrivenThreshold, computeItemPassRates, findWeakItems } from "../lib/creative-checklist-stats";

const CONFIG_PATH = path.join(process.cwd(), "data", "creative-checklist.json");
const TOP_N = Number(process.env.CHECKLIST_TOP_N || 40);
const LOOKBACK_DAYS = Number(process.env.CHECKLIST_LOOKBACK_DAYS || 30);

interface TopCreative {
  groupKey: string;
  repAdId: string;
  accountId: string;
  spend: number;
  inbox: number;
  leads: number;
  cpi: number;
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getTime() + offset * 24 * 60 * 60 * 1000);
  return monday.toISOString().slice(0, 10);
}

function selectTopCreatives(insights: AdInsight[]): TopCreative[] {
  const rowMap = new Map<string, TopCreative>();
  for (const ins of insights) {
    const cid = ins.parsed.creativeId;
    if (!cid || !ins.adId) continue;
    const awBase = ins.parsed.awCode.replace(/-\d+$/, "");
    const groupKey = `${awBase}-${cid}`;
    const row = rowMap.get(groupKey) || {
      groupKey,
      repAdId: ins.adId,
      accountId: ins.accountId,
      spend: 0,
      inbox: 0,
      leads: 0,
      cpi: 0,
    };
    row.spend += ins.spend;
    row.inbox += ins.inbox;
    row.leads += ins.leads;
    rowMap.set(groupKey, row);
  }

  return [...rowMap.values()]
    .map((row) => ({ ...row, cpi: row.inbox > 0 ? row.spend / row.inbox : 0 }))
    .filter((row) => hasReliableCost(row, "inbox"))
    .sort((a, b) => a.cpi - b.cpi)
    .slice(0, TOP_N);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }
  const tokens = [
    process.env.META_ACCESS_TOKEN,
    process.env.META_ACCESS_TOKEN_2,
    process.env.META_ACCESS_TOKEN_3,
  ].filter((t): t is string => Boolean(t));
  if (!tokens.length) {
    console.error("Missing META_ACCESS_TOKEN");
    process.exit(1);
  }

  const config = readChecklistConfig();
  if (!config) {
    console.error("Could not read data/creative-checklist.json");
    process.exit(1);
  }

  const since = isoDateDaysAgo(LOOKBACK_DAYS);
  const until = isoDateDaysAgo(0);

  console.log(`Fetching insights ${since} → ${until} across ${tokens.length} token(s)...`);
  const results = await Promise.all(tokens.map((token) => fetchAllInsights(token, undefined, since, until)));
  const allInsights = results.flatMap((r) => r.insights);
  for (const r of results) {
    for (const f of r.failures) console.warn(`[warn] ${f.scope} ${f.accountName || f.accountId}: ${f.message}`);
  }

  const topCreatives = selectTopCreatives(allInsights);
  if (!topCreatives.length) {
    console.error("No Top creatives found with reliable CPI in the selected window. Aborting without changes.");
    process.exit(1);
  }
  console.log(`Selected ${topCreatives.length} Top creatives by lowest reliable CPI.`);

  const tokenByAccount = await buildTokenByAccount(tokens);
  const assets = await fetchCreativeAssets(
    topCreatives.map((c) => c.repAdId),
    topCreatives.map((c) => c.accountId),
    tokenByAccount,
    tokens[0]
  );

  const allItems = config.categories.flatMap((category) => category.items);
  const perAdScores: number[] = [];
  const perAdItemResults: { id: string; met: boolean }[][] = [];
  let imageCount = 0;
  let videoCount = 0;
  let failedCount = 0;

  for (const creative of topCreatives) {
    const asset = assets[creative.repAdId];
    if (!asset?.thumbnailUrl) {
      failedCount += 1;
      continue;
    }
    const mediaType: MediaType = asset.objectType === "VIDEO" || asset.videoId ? "video" : "image";
    const relevantItems = allItems.filter(
      (item) => !item.appliesTo || item.appliesTo === "both" || item.appliesTo === mediaType
    );

    console.log(`  Scoring ${creative.groupKey} url=${asset.thumbnailUrl.slice(0, 80)}...`);
    try {
      const aiResults = await scoreImageAgainstChecklist(apiKey, asset.thumbnailUrl, relevantItems, mediaType);
      const checkedIds = aiResults.filter((r) => r.met).map((r) => r.id);
      const score = scoreChecklist(config, checkedIds, mediaType);
      perAdScores.push(score.percent);
      perAdItemResults.push(aiResults);
      if (mediaType === "video") videoCount += 1;
      else imageCount += 1;
      console.log(`  ${creative.groupKey}: ${score.percent}% (${mediaType}, CPI ฿${creative.cpi.toFixed(0)})`);
    } catch (err) {
      failedCount += 1;
      const detail = err instanceof ChecklistAiError ? ` | detail: ${err.detail ?? "-"}` : "";
      const message = err instanceof ChecklistAiError ? err.message : (err instanceof Error ? err.message : "unknown error");
      console.warn(`  [skip] ${creative.groupKey}: ${message}${detail}`);
    }
  }

  if (!perAdScores.length) {
    console.error("No Top creative could be scored successfully. Aborting without changes.");
    process.exit(1);
  }

  const newThreshold = computeDataDrivenThreshold(perAdScores, { percentileRank: 20, min: 50, max: 85, step: 5 });
  const itemPassRates = computeItemPassRates(perAdItemResults);
  const weakItems = findWeakItems(itemPassRates, 30, 5);
  const avgScore = Math.round((perAdScores.reduce((a, b) => a + b, 0) / perAdScores.length) * 10) / 10;
  const minScore = Math.min(...perAdScores);

  const todayMonday = mondayOf(new Date().toISOString().slice(0, 10));
  const versionSuffix = config.version.match(/\.(\S+)$/)?.[1] || "v1";
  const nextVersion = `${todayMonday}.${versionSuffix === "v1" && config.lastUpdated === todayMonday ? `v${(Number(versionSuffix.slice(1)) || 1) + 1}` : "v1"}`;

  const weakItemsNote = weakItems.length
    ? ` ⚠️ ข้อที่ Top ads ทำตามน้อย (<30%) ควรทบทวนน้ำหนัก/ความจำเป็น: ${weakItems.map((w) => `${w.id} (${w.rate}%)`).join(", ")}.`
    : "";

  const updatedConfig: ChecklistConfig = {
    ...config,
    version: nextVersion,
    lastUpdated: todayMonday,
    passThreshold: newThreshold,
    sourceNote:
      `สรุปจาก Top ${perAdScores.length} ครีเอทีฟ (CPI ต่ำสุดที่มีข้อมูลเชื่อถือได้) ในช่วง ${since} ถึง ${until} ` +
      `(${imageCount} static image, ${videoCount} วิดีโอ${failedCount ? `, ${failedCount} รายการข้ามเพราะดึงรูป/วิเคราะห์ไม่สำเร็จ` : ""}). ` +
      `คะแนนเฉลี่ยของ Top ads = ${avgScore}%, ต่ำสุด = ${minScore}%. ` +
      `passThreshold ปรับเป็น ${newThreshold}% โดยอิงจาก percentile 20 ของคะแนนจริงกลุ่มนี้ (แทนค่าคงที่เดิม) ` +
      `เพื่อให้ Top ads ส่วนใหญ่ผ่านเกณฑ์จริง.${weakItemsNote} อัปเดตอัตโนมัติทุกสัปดาห์ผ่าน GitHub Actions ` +
      `(scripts/refresh-checklist.ts) — merge ผ่าน Pull Request หลังรีวิว.`,
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updatedConfig, null, 2) + "\n", "utf-8");
  console.log(`\nWrote updated checklist: passThreshold ${config.passThreshold} → ${newThreshold}, version ${nextVersion}`);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const summary = [
    `### Checklist refresh — ${todayMonday}`,
    `- Top ads analyzed: **${perAdScores.length}** (${imageCount} image, ${videoCount} video, ${failedCount} skipped)`,
    `- Score range: **${minScore}% – ${Math.max(...perAdScores)}%**, average **${avgScore}%**`,
    `- passThreshold: **${config.passThreshold}% → ${newThreshold}%**`,
    weakItems.length
      ? `- ⚠️ Low pass-rate items (review needed): ${weakItems.map((w) => `\`${w.id}\` (${w.rate}%)`).join(", ")}`
      : `- All checklist items have healthy pass rates among Top ads.`,
  ].join("\n");
  console.log(`\n${summary}`);
  if (summaryPath) fs.appendFileSync(summaryPath, summary + "\n");

  const prBodyPath = process.env.CHECKLIST_PR_BODY_PATH;
  if (prBodyPath) fs.writeFileSync(prBodyPath, summary + "\n", "utf-8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
