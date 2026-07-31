import { META_GRAPH_API_BASE } from "./meta-version";
import { normalizeAccountId } from "./creative-routing";

const META_API_BASE = META_GRAPH_API_BASE;
const BATCH_SIZE = 50;

interface BatchItem {
  code: number;
  body: string;
}

export interface CreativeAsset {
  thumbnailUrl: string;
  objectType: string;
  videoId?: string;
}

async function fetchBatch(
  requests: { method: "GET"; relative_url: string }[],
  token: string
): Promise<BatchItem[]> {
  if (!requests.length) return [];
  const res = await fetch(
    `${META_API_BASE}?batch=${encodeURIComponent(JSON.stringify(requests))}&access_token=${token}`,
    { method: "POST" }
  );
  return res.json() as Promise<BatchItem[]>;
}

async function fetchAccountIds(token: string): Promise<string[]> {
  const accountIds: string[] = [];
  let nextUrl: string | null = `${META_API_BASE}/me/adaccounts?fields=id&limit=500&access_token=${token}`;

  while (nextUrl) {
    const res: Response = await fetch(nextUrl);
    const data: { error?: { message: string }; data?: { id: string }[]; paging?: { next?: string } } = await res.json();
    if (data.error) throw new Error(data.error.message);
    accountIds.push(...(data.data || []).map((account: { id: string }) => normalizeAccountId(account.id)));
    nextUrl = data.paging?.next || null;
  }

  return accountIds;
}

export async function buildTokenByAccount(tokens: string[]): Promise<Record<string, string>> {
  const tokenByAccount: Record<string, string> = {};
  const results = await Promise.allSettled(
    tokens.map(async (token) => ({ token, accountIds: await fetchAccountIds(token) }))
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const accountId of result.value.accountIds) {
      tokenByAccount[accountId] ||= result.value.token;
    }
  }

  return tokenByAccount;
}

interface CreativeRaw {
  thumbnailUrl: string;
  objectType: string;
  videoId?: string;
  imageHash?: string;
  accountId: string;
  storyId?: string;
}

async function processCreativeBatch(
  adIds: string[],
  accountIds: string[],
  token: string
): Promise<Record<string, CreativeAsset>> {
  const batchParam = adIds.map((id) => ({ method: "GET" as const, relative_url: `${id}?fields=creative,account_id` }));
  const batchData = await fetchBatch(batchParam, token);
  const creativeIds: string[] = [];
  const adToCreative: Record<string, string> = {};
  const creativeToAccount: Record<string, string> = {};

  batchData.forEach((item, idx) => {
    if (item.code !== 200) return;
    const parsed = JSON.parse(item.body);
    if (!parsed.creative?.id) return;
    const cid = parsed.creative.id as string;
    creativeIds.push(cid);
    adToCreative[adIds[idx]] = cid;
    creativeToAccount[cid] = normalizeAccountId(String(parsed.account_id || accountIds[idx] || ""));
  });

  if (!creativeIds.length) return {};

  const creativeBatch = creativeIds.map((id) => ({
    method: "GET" as const,
    relative_url: `${id}?fields=thumbnail_url,video_id,object_type,image_hash,effective_object_story_id&thumbnail_width=800&thumbnail_height=800`,
  }));
  const creativeData = await fetchBatch(creativeBatch, token);
  const accountToHashes: Record<string, string[]> = {};
  const creativeRaw: Record<string, CreativeRaw> = {};

  creativeIds.forEach((cid, idx) => {
    if (creativeData[idx]?.code !== 200) return;
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
      accountToHashes[accountId] ||= [];
      accountToHashes[accountId].push(c.image_hash);
    }
  });

  const hashToUrl: Record<string, string> = {};
  await Promise.all(
    Object.entries(accountToHashes).flatMap(([accountId, hashes]) => {
      const uniqueHashes = [...new Set(hashes)];
      const requests: Promise<void>[] = [];
      for (let h = 0; h < uniqueHashes.length; h += BATCH_SIZE) {
        const hashParam = encodeURIComponent(JSON.stringify(uniqueHashes.slice(h, h + BATCH_SIZE)));
        requests.push(
          (async () => {
            const imgRes = await fetch(
              `${META_API_BASE}/act_${accountId}/adimages?hashes=${hashParam}&fields=hash,url&access_token=${token}`
            );
            const imgData = await imgRes.json();
            for (const img of imgData.data || []) {
              if (img.hash && img.url) hashToUrl[img.hash] = img.url;
            }
          })()
        );
      }
      return requests;
    })
  );

  const boostStories = Object.values(creativeRaw).filter((raw) => raw.storyId);
  const storyToUrl: Record<string, string> = {};
  if (boostStories.length) {
    const pageIds = [...new Set(boostStories.map((raw) => raw.storyId!.split("_")[0]))];
    const pageTokenMap: Record<string, string> = {};
    const pageTokenData = await fetchBatch(
      pageIds.map((pageId) => ({ method: "GET" as const, relative_url: `${pageId}?fields=access_token` })),
      token
    );
    pageIds.forEach((pageId, idx) => {
      if (pageTokenData[idx]?.code !== 200) return;
      const page = JSON.parse(pageTokenData[idx].body);
      if (page.access_token) pageTokenMap[pageId] = page.access_token;
    });
    await Promise.all(
      boostStories.map(async (raw) => {
        const storyId = raw.storyId!;
        const pageToken = pageTokenMap[storyId.split("_")[0]];
        if (!pageToken) return;
        const picRes = await fetch(`${META_API_BASE}/${storyId}?fields=full_picture&access_token=${pageToken}`);
        const picData = await picRes.json();
        if (picData.full_picture) storyToUrl[storyId] = picData.full_picture;
      })
    );
  }

  const videoIds = [...new Set(Object.values(creativeRaw).filter((raw) => raw.videoId).map((raw) => raw.videoId as string))];
  const videoThumbMap: Record<string, string> = {};
  const videoRequests: Promise<void>[] = [];
  for (let v = 0; v < videoIds.length; v += BATCH_SIZE) {
    const videoBatch = videoIds.slice(v, v + BATCH_SIZE);
    videoRequests.push(
      (async () => {
        const data = await fetchBatch(
          videoBatch.map((videoId) => ({ method: "GET" as const, relative_url: `${videoId}?fields=thumbnails{uri,width,height}` })),
          token
        );
        videoBatch.forEach((videoId, idx) => {
          if (data[idx]?.code !== 200) return;
          const thumbs: { uri: string; width: number; height: number }[] = JSON.parse(data[idx].body).thumbnails?.data || [];
          if (thumbs.length) videoThumbMap[videoId] = thumbs.sort((a, b) => b.width - a.width)[0].uri;
        });
      })()
    );
  }
  await Promise.all(videoRequests);

  const result: Record<string, CreativeAsset> = {};
  for (const [adId, cid] of Object.entries(adToCreative)) {
    const raw = creativeRaw[cid];
    if (!raw) continue;
    result[adId] = {
      thumbnailUrl:
        (raw.imageHash && hashToUrl[raw.imageHash]) ||
        (raw.storyId && storyToUrl[raw.storyId]) ||
        (raw.videoId && videoThumbMap[raw.videoId]) ||
        raw.thumbnailUrl,
      objectType: raw.objectType,
      videoId: raw.videoId,
    };
  }
  return result;
}

export async function fetchCreativeAssets(
  adIds: string[],
  accountIds: string[],
  tokenByAccount: Record<string, string>,
  fallbackToken: string
): Promise<Record<string, CreativeAsset>> {
  const uniquePairs = [...new Map(adIds.map((adId, index) => [`${adId}|${accountIds[index] || ""}`, { adId, accountId: accountIds[index] || "" }])).values()];

  const groups = new Map<string, { adIds: string[]; accountIds: string[] }>();
  for (const pair of uniquePairs) {
    const token = tokenByAccount[pair.accountId] || fallbackToken;
    const group = groups.get(token) || { adIds: [], accountIds: [] };
    group.adIds.push(pair.adId);
    group.accountIds.push(pair.accountId);
    groups.set(token, group);
  }

  const results = await Promise.all(
    [...groups.entries()].flatMap(([token, group]) => {
      const requests: Promise<Record<string, CreativeAsset>>[] = [];
      for (let i = 0; i < group.adIds.length; i += BATCH_SIZE) {
        requests.push(processCreativeBatch(group.adIds.slice(i, i + BATCH_SIZE), group.accountIds.slice(i, i + BATCH_SIZE), token));
      }
      return requests;
    })
  );

  return Object.assign({}, ...results);
}
