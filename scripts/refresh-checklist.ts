/**
 * Weekly creative-checklist refresh.
 *
 * Fetches BOTH this period's Top-performing ads (lowest reliable CPI) and
 * Bottom-performing ads (highest reliable CPI), scores each against the
 * CURRENT checklist using the same OpenAI vision scorer used in the product,
 * then:
 *   1. Sets `passThreshold` (and per-media thresholds) at the score that best
 *      SEPARATES Top from Bottom ads — not at whatever lets most Top ads pass.
 *      A threshold derived from Top ads alone just keeps dropping until the
 *      checklist can no longer tell a good ad from a bad one.
 *   2. Flags checklist items whose pass rate among Top ads is no higher than
 *      among Bottom ads (low lift = not predictive) for human review in the
 *      sourceNote (never auto-deletes criteria).
 *   3. Skips items marked `requiresVideoPlayback` — videos are scored from a
 *      single thumbnail frame, so criteria like "hook in first 3 seconds"
 *      cannot be judged and would only produce fake failures.
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
import {
  computeSeparationThreshold,
  computeItemPassRates,
  computeItemLifts,
  findNonDiscriminativeItems,
  computeWeightUpdatesFromLifts,
} from "../lib/creative-checklist-stats";

const CONFIG_PATH = path.join(process.cwd(), "data", "creative-checklist.json");
// เก็บผลวิเคราะห์รายแอดของทุกรอบไว้เป็นประวัติ เพื่อสะสมข้อมูลไปหาแพทเทิร์น
// "แอดนางฟ้า" รายโปรแกรม/สาขาในระยะยาว (ก่อนหน้านี้ข้อมูลถูกทิ้งหมดหลังรันเสร็จ)
const ANALYSIS_DIR = path.join(process.cwd(), "data", "checklist-analysis");
const TOP_N = Number(process.env.CHECKLIST_TOP_N || 40);
const BOTTOM_N = Number(process.env.CHECKLIST_BOTTOM_N || TOP_N);
const LOOKBACK_DAYS = Number(process.env.CHECKLIST_LOOKBACK_DAYS || 30);
/** ต้องมีวิดีโอในกลุ่ม Top อย่างน้อยเท่านี้ ถึงจะคำนวณเกณฑ์วิดีโอแยก ไม่งั้นใช้เกณฑ์ภาพนิ่ง */
const MIN_VIDEO_SAMPLE = 6;

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

function selectRankedCreatives(insights: AdInsight[]): { top: TopCreative[]; bottom: TopCreative[] } {
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

  const ranked = [...rowMap.values()]
    .map((row) => ({ ...row, cpi: row.inbox > 0 ? row.spend / row.inbox : 0 }))
    .filter((row) => hasReliableCost(row, "inbox"))
    .sort((a, b) => a.cpi - b.cpi);

  const top = ranked.slice(0, TOP_N);
  // Bottom = CPI แพงสุดในกลุ่มที่ข้อมูลเชื่อถือได้เหมือนกัน และต้องไม่ทับกับ Top
  const bottom = ranked.slice(Math.max(top.length, ranked.length - BOTTOM_N));
  return { top, bottom };
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

  const { top: topCreatives, bottom: bottomCreatives } = selectRankedCreatives(allInsights);
  if (!topCreatives.length) {
    console.error("No Top creatives found with reliable CPI in the selected window. Aborting without changes.");
    process.exit(1);
  }
  console.log(
    `Selected ${topCreatives.length} Top (lowest CPI) and ${bottomCreatives.length} Bottom (highest CPI) creatives.`
  );

  const tokenByAccount = await buildTokenByAccount(tokens);
  const allCreatives = [...topCreatives, ...bottomCreatives];
  const assets = await fetchCreativeAssets(
    allCreatives.map((c) => c.repAdId),
    allCreatives.map((c) => c.accountId),
    tokenByAccount,
    tokens[0]
  );

  // ข้อ requiresVideoPlayback ตัดสินจาก thumbnail ไม่ได้ — ไม่ส่งให้ AI และไม่ถูกนับคะแนน
  const checklist: ChecklistConfig = config;
  const scorableItems = config.categories
    .flatMap((category) => category.items)
    .filter((item) => !item.requiresVideoPlayback);

  interface AdAnalysisRecord {
    group: "top" | "bottom";
    groupKey: string;
    accountId: string;
    media: MediaType;
    spend: number;
    inbox: number;
    cpi: number;
    score: number;
    /** ผลรายข้อจาก AI: item id → ผ่าน/ไม่ผ่าน */
    items: Record<string, boolean>;
  }

  interface GroupResult {
    scores: number[];
    imageScores: number[];
    videoScores: number[];
    itemResults: { id: string; met: boolean }[][];
    records: AdAnalysisRecord[];
    imageCount: number;
    videoCount: number;
    failedCount: number;
  }

  async function scoreGroup(groupLabel: "top" | "bottom", creatives: TopCreative[]): Promise<GroupResult> {
    const result: GroupResult = {
      scores: [],
      imageScores: [],
      videoScores: [],
      itemResults: [],
      records: [],
      imageCount: 0,
      videoCount: 0,
      failedCount: 0,
    };
    for (const creative of creatives) {
      const asset = assets[creative.repAdId];
      if (!asset?.thumbnailUrl) {
        result.failedCount += 1;
        continue;
      }
      const mediaType: MediaType = asset.objectType === "VIDEO" || asset.videoId ? "video" : "image";
      const relevantItems = scorableItems.filter(
        (item) => !item.appliesTo || item.appliesTo === "both" || item.appliesTo === mediaType
      );

      console.log(`  [${groupLabel}] Scoring ${creative.groupKey} url=${asset.thumbnailUrl.slice(0, 80)}...`);
      try {
        const aiResults = await scoreImageAgainstChecklist(apiKey!, asset.thumbnailUrl, relevantItems, mediaType);
        const checkedIds = aiResults.filter((r) => r.met).map((r) => r.id);
        const score = scoreChecklist(checklist, checkedIds, mediaType);
        result.scores.push(score.percent);
        result.itemResults.push(aiResults);
        result.records.push({
          group: groupLabel,
          groupKey: creative.groupKey,
          accountId: creative.accountId,
          media: mediaType,
          spend: Math.round(creative.spend * 100) / 100,
          inbox: creative.inbox,
          cpi: Math.round(creative.cpi * 100) / 100,
          score: score.percent,
          items: Object.fromEntries(aiResults.map((r) => [r.id, r.met])),
        });
        if (mediaType === "video") {
          result.videoCount += 1;
          result.videoScores.push(score.percent);
        } else {
          result.imageCount += 1;
          result.imageScores.push(score.percent);
        }
        console.log(`  [${groupLabel}] ${creative.groupKey}: ${score.percent}% (${mediaType}, CPI ฿${creative.cpi.toFixed(0)})`);
      } catch (err) {
        result.failedCount += 1;
        const detail = err instanceof ChecklistAiError ? ` | detail: ${err.detail ?? "-"}` : "";
        const message = err instanceof ChecklistAiError ? err.message : (err instanceof Error ? err.message : "unknown error");
        console.warn(`  [skip] [${groupLabel}] ${creative.groupKey}: ${message}${detail}`);
      }
    }
    return result;
  }

  const topGroup = await scoreGroup("top", topCreatives);
  const bottomGroup = await scoreGroup("bottom", bottomCreatives);

  if (!topGroup.scores.length) {
    console.error("No Top creative could be scored successfully. Aborting without changes.");
    process.exit(1);
  }

  // เกณฑ์ผ่าน = จุดที่แยกคะแนน Top ออกจาก Bottom ได้ดีที่สุด (ไม่ใช่จุดที่ทำให้ Top ผ่านเยอะสุด)
  const thresholdOptions = { min: 50, max: 85, step: 5 };
  const newThreshold = computeSeparationThreshold(topGroup.scores, bottomGroup.scores, thresholdOptions);
  const imageThreshold = computeSeparationThreshold(topGroup.imageScores, bottomGroup.imageScores, thresholdOptions);
  const videoThreshold =
    topGroup.videoScores.length >= MIN_VIDEO_SAMPLE
      ? computeSeparationThreshold(topGroup.videoScores, bottomGroup.videoScores, {
          ...thresholdOptions,
          minBottomSample: 3,
        })
      : imageThreshold;

  const topPassRates = computeItemPassRates(topGroup.itemResults);
  const bottomPassRates = computeItemPassRates(bottomGroup.itemResults);
  const itemLifts = computeItemLifts(topPassRates, bottomPassRates);
  const weakItems = findNonDiscriminativeItems(itemLifts, 10, 5);
  const weightUpdates = computeWeightUpdatesFromLifts(itemLifts, 5);

  const perAdScores = topGroup.scores;
  const { imageCount, videoCount, failedCount } = topGroup;
  const avgScore = Math.round((perAdScores.reduce((a, b) => a + b, 0) / perAdScores.length) * 10) / 10;
  const minScore = Math.min(...perAdScores);
  const bottomAvg = bottomGroup.scores.length
    ? Math.round((bottomGroup.scores.reduce((a, b) => a + b, 0) / bottomGroup.scores.length) * 10) / 10
    : null;

  const todayMonday = mondayOf(new Date().toISOString().slice(0, 10));
  const versionSuffix = config.version.match(/\.(\S+)$/)?.[1] || "v1";
  const nextVersion = `${todayMonday}.${versionSuffix === "v1" && config.lastUpdated === todayMonday ? `v${(Number(versionSuffix.slice(1)) || 1) + 1}` : "v1"}`;

  const weakItemsNote = weakItems.length
    ? ` ⚠️ ข้อที่แยกแอดดี/แย่ไม่ได้ (Top ทำไม่ต่างจาก Bottom) ควรทบทวน: ${weakItems.map((w) => `${w.id} (Top ${w.topRate}% vs Bottom ${w.bottomRate}%)`).join(", ")}.`
    : "";

  const updatedCategories = config.categories.map((cat) => ({
    ...cat,
    items: cat.items.map((item) => ({
      ...item,
      weight: weightUpdates.has(item.id) ? weightUpdates.get(item.id)! : item.weight,
    })),
  }));

  const updatedConfig: ChecklistConfig = {
    ...config,
    version: nextVersion,
    lastUpdated: todayMonday,
    passThreshold: newThreshold,
    passThresholdByMedia: { image: imageThreshold, video: videoThreshold },
    categories: updatedCategories,
    sourceNote:
      `เทียบ Top ${perAdScores.length} ครีเอทีฟ (CPI ต่ำสุด) กับ Bottom ${bottomGroup.scores.length} ครีเอทีฟ (CPI สูงสุด) ` +
      `ที่มีข้อมูลเชื่อถือได้ ในช่วง ${since} ถึง ${until} ` +
      `(Top: ${imageCount} ภาพนิ่ง, ${videoCount} วิดีโอ${failedCount ? `, ข้าม ${failedCount}` : ""}). ` +
      `คะแนนเฉลี่ย Top = ${avgScore}%${bottomAvg !== null ? `, Bottom = ${bottomAvg}%` : ""}. ` +
      `เกณฑ์ผ่านตั้งที่จุดที่แยกสองกลุ่มได้ดีที่สุด: ภาพนิ่ง ${imageThreshold}%, วิดีโอ ${videoThreshold}% ` +
      `(ไม่ใช่จุดที่ทำให้ Top ผ่านเยอะสุดแบบเดิม). ข้อที่ต้องดูวิดีโอจริง (requiresVideoPlayback) ` +
      `ไม่ถูกนับคะแนนอัตโนมัติ — แสดงให้ตรวจเองใน UI แทน.${weakItemsNote} ` +
      `อัปเดตอัตโนมัติทุกสัปดาห์ผ่าน GitHub Actions (scripts/refresh-checklist.ts) — merge ผ่าน Pull Request หลังรีวิว.`,
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updatedConfig, null, 2) + "\n", "utf-8");
  console.log(
    `\nWrote updated checklist: passThreshold ${config.passThreshold} → ${newThreshold} (image ${imageThreshold}, video ${videoThreshold}), version ${nextVersion}`
  );

  const analysisSnapshot = {
    generatedAt: new Date().toISOString(),
    since,
    until,
    configVersion: nextVersion,
    thresholds: { combined: newThreshold, image: imageThreshold, video: videoThreshold },
    itemLifts,
    ads: [...topGroup.records, ...bottomGroup.records],
  };
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  const analysisPath = path.join(ANALYSIS_DIR, `${until}.json`);
  fs.writeFileSync(analysisPath, JSON.stringify(analysisSnapshot, null, 2) + "\n", "utf-8");
  console.log(`Wrote per-ad analysis snapshot: ${analysisPath} (${analysisSnapshot.ads.length} ads)`);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const summary = [
    `### Checklist refresh — ${todayMonday}`,
    `- Top ads analyzed: **${perAdScores.length}** (${imageCount} image, ${videoCount} video, ${failedCount} skipped)`,
    `- Bottom ads analyzed: **${bottomGroup.scores.length}** (${bottomGroup.imageCount} image, ${bottomGroup.videoCount} video, ${bottomGroup.failedCount} skipped)`,
    `- Top score range: **${minScore}% – ${Math.max(...perAdScores)}%**, average **${avgScore}%**${bottomAvg !== null ? ` · Bottom average: **${bottomAvg}%**` : ""}`,
    `- passThreshold (separation-based): **${config.passThreshold}% → ${newThreshold}%** (image **${imageThreshold}%**, video **${videoThreshold}%**)`,
    weakItems.length
      ? `- ⚠️ Non-discriminative items (Top ≈ Bottom, review needed): ${weakItems.map((w) => `\`${w.id}\` (Top ${w.topRate}% vs Bottom ${w.bottomRate}%)`).join(", ")}`
      : `- All checklist items discriminate Top from Bottom ads.`,
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
