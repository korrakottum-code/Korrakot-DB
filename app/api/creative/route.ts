import { NextRequest, NextResponse } from "next/server";

const META_API_BASE = "https://graph.facebook.com/v19.0";

export const dynamic = "force-dynamic";

// Parse accountId from adId — Meta ad IDs are per-account, ad belongs to account
// We pass account_ids alongside ad_ids as a parallel array
export async function GET(req: NextRequest) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "No token" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const adIds = searchParams.get("ad_ids")?.split(",").filter(Boolean) || [];
  const accountIds = searchParams.get("account_ids")?.split(",").filter(Boolean) || [];

  if (!adIds.length) return NextResponse.json({});

  const batchSize = 50;
  const result: Record<string, { thumbnailUrl: string; objectType: string; videoId?: string }> = {};

  for (let i = 0; i < adIds.length; i += batchSize) {
    const batch = adIds.slice(i, i + batchSize);
    const batchAccounts = accountIds.slice(i, i + batchSize);

    // Step 1: get creative ID + account from each ad
    const batchParam = batch.map((id) => ({ method: "GET", relative_url: `${id}?fields=creative,account_id` }));
    const res = await fetch(`${META_API_BASE}?batch=${encodeURIComponent(JSON.stringify(batchParam))}&access_token=${token}`, { method: "POST" });
    const batchData: { code: number; body: string }[] = await res.json();

    const creativeIds: string[] = [];
    const adToCreative: Record<string, string> = {};
    const creativeToAccount: Record<string, string> = {};

    batchData.forEach((item, idx) => {
      if (item.code === 200) {
        const parsed = JSON.parse(item.body);
        if (parsed.creative?.id) {
          const cid = parsed.creative.id;
          creativeIds.push(cid);
          adToCreative[batch[idx]] = cid;
          // use account_id from response, or fall back to parallel array
          creativeToAccount[cid] = parsed.account_id || batchAccounts[idx] || "";
        }
      }
    });

    if (!creativeIds.length) continue;

    // Step 2: fetch creative details — also fetch effective_object_story_id for boosted posts
    const creativeBatch = creativeIds.map((id) => ({
      method: "GET",
      relative_url: `${id}?fields=thumbnail_url,video_id,object_type,image_hash,effective_object_story_id&thumbnail_width=800&thumbnail_height=800`,
    }));
    const creativeRes = await fetch(
      `${META_API_BASE}?batch=${encodeURIComponent(JSON.stringify(creativeBatch))}&access_token=${token}`,
      { method: "POST" }
    );
    const creativeData: { code: number; body: string }[] = await creativeRes.json();

    // Collect image hashes per account for bulk lookup
    const accountToHashes: Record<string, string[]> = {};
    const creativeRaw: Record<string, { thumbnailUrl: string; objectType: string; videoId?: string; imageHash?: string; accountId: string; storyId?: string }> = {};

    creativeIds.forEach((cid, idx) => {
      if (creativeData[idx]?.code === 200) {
        const c = JSON.parse(creativeData[idx].body);
        const accountId = creativeToAccount[cid] || "";
        const isBoostPost = (c.object_type || "") === "STATUS";
        creativeRaw[cid] = {
          thumbnailUrl: isBoostPost ? "" : (c.thumbnail_url || ""),
          objectType: isBoostPost ? "BOOST_POST" : (c.object_type || ""),
          videoId: c.video_id || undefined,
          imageHash: c.image_hash || undefined,
          accountId,
          storyId: isBoostPost ? (c.effective_object_story_id || undefined) : undefined,
        };
        if (c.image_hash && accountId) {
          if (!accountToHashes[accountId]) accountToHashes[accountId] = [];
          accountToHashes[accountId].push(c.image_hash);
        }
      }
    });

    // Step 3: fetch full-res image URLs from /adimages for each account
    const hashToUrl: Record<string, string> = {};
    for (const [accountId, hashes] of Object.entries(accountToHashes)) {
      const uniqueHashes = [...new Set(hashes)];
      const hashBatches: string[][] = [];
      for (let h = 0; h < uniqueHashes.length; h += 50) hashBatches.push(uniqueHashes.slice(h, h + 50));
      for (const hb of hashBatches) {
        const hashParam = encodeURIComponent(JSON.stringify(hb));
        const imgRes = await fetch(`${META_API_BASE}/act_${accountId}/adimages?hashes=${hashParam}&fields=hash,url&access_token=${token}`);
        const imgData = await imgRes.json();
        if (imgData.data) {
          for (const img of imgData.data) {
            if (img.hash && img.url) hashToUrl[img.hash] = img.url;
          }
        }
      }
    }

    // Step 3b: fetch full_picture for boosted posts via Page token
    const boostStories = Object.values(creativeRaw).filter((r) => r.storyId);
    const storyToUrl: Record<string, string> = {};
    if (boostStories.length) {
      // Group by pageId (first part of story_id e.g. "104851925730615_845306...")
      const pageIds = [...new Set(boostStories.map((r) => r.storyId!.split("_")[0]))];
      // Fetch page tokens in batch
      const pageTokenMap: Record<string, string> = {};
      const ptBatch = pageIds.map((pid) => ({ method: "GET", relative_url: `${pid}?fields=access_token` }));
      const ptRes = await fetch(`${META_API_BASE}?batch=${encodeURIComponent(JSON.stringify(ptBatch))}&access_token=${token}`, { method: "POST" });
      const ptData: { code: number; body: string }[] = await ptRes.json();
      pageIds.forEach((pid, idx) => {
        if (ptData[idx]?.code === 200) {
          const pt = JSON.parse(ptData[idx].body);
          if (pt.access_token) pageTokenMap[pid] = pt.access_token;
        }
      });
      // Fetch full_picture for each story using its page token
      for (const raw of boostStories) {
        if (!raw.storyId) continue;
        const pageId = raw.storyId.split("_")[0];
        const pageToken = pageTokenMap[pageId];
        if (!pageToken) continue;
        const picRes = await fetch(`${META_API_BASE}/${raw.storyId}?fields=full_picture&access_token=${pageToken}`);
        const picData = await picRes.json();
        if (picData.full_picture) storyToUrl[raw.storyId] = picData.full_picture;
      }
    }

    // Step 3c: fetch video thumbnails for video creatives
    const videoIds = [...new Set(
      Object.values(creativeRaw)
        .filter((r) => r.videoId)
        .map((r) => r.videoId as string)
    )];

    const videoThumbMap: Record<string, string> = {};
    for (let v = 0; v < videoIds.length; v += 50) {
      const vBatch = videoIds.slice(v, v + 50).map((vid) => ({
        method: "GET",
        relative_url: `${vid}?fields=thumbnails{uri,width,height}`,
      }));
      const vRes = await fetch(
        `${META_API_BASE}?batch=${encodeURIComponent(JSON.stringify(vBatch))}&access_token=${token}`,
        { method: "POST" }
      );
      const vData: { code: number; body: string }[] = await vRes.json();
      videoIds.slice(v, v + 50).forEach((vid, idx) => {
        if (vData[idx]?.code === 200) {
          const vd = JSON.parse(vData[idx].body);
          // Pick largest thumbnail
          const thumbs: { uri: string; width: number; height: number }[] = vd.thumbnails?.data || [];
          if (thumbs.length) {
            const best = thumbs.sort((a, b) => b.width - a.width)[0];
            videoThumbMap[vid] = best.uri;
          }
        }
      });
    }

    // Step 4: build final result — priority: adimages full-res > video thumb > large thumbnail_url
    for (const [adId, cid] of Object.entries(adToCreative)) {
      const raw = creativeRaw[cid];
      if (!raw) continue;
      const fullImgUrl = raw.imageHash ? hashToUrl[raw.imageHash] : undefined;
      const videoThumb = raw.videoId ? videoThumbMap[raw.videoId] : undefined;
      const boostPic = raw.storyId ? storyToUrl[raw.storyId] : undefined;
      result[adId] = {
        thumbnailUrl: fullImgUrl || boostPic || videoThumb || raw.thumbnailUrl,
        objectType: raw.objectType,
        videoId: raw.videoId,
      };
    }
  }

  return NextResponse.json(result);
}
