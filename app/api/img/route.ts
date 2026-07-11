import { NextRequest, NextResponse } from "next/server";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isAllowedMetaMediaUrl } from "@/lib/security";
import { requireInternalApiAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

async function fetchAllowedImage(rawUrl: string): Promise<Response> {
  let currentUrl = rawUrl;
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    if (!isAllowedMetaMediaUrl(currentUrl)) throw new Error("blocked url");
    const response = await fetch(currentUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || attempt === MAX_REDIRECTS) throw new Error("invalid redirect");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new Error("too many redirects");
}

export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  const rate = consumeApiRateLimit(req.headers, "image", 240, 60_000);
  if (!rate.allowed) {
    return new NextResponse("too many requests", {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSeconds) },
    });
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("missing url", { status: 400 });
  if (!isAllowedMetaMediaUrl(url)) return new NextResponse("blocked url", { status: 400 });

  try {
    const res = await fetchAllowedImage(url);
    if (!res.ok) return new NextResponse("fetch failed", { status: 502 });

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    if (!contentType.startsWith("image/")) {
      await res.body?.cancel();
      return new NextResponse("invalid content type", { status: 415 });
    }
    const contentLength = Number(res.headers.get("content-length") || "0");
    if (contentLength > MAX_IMAGE_BYTES) {
      await res.body?.cancel();
      return new NextResponse("image too large", { status: 413 });
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return new NextResponse("image too large", { status: 413 });
    }

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("error", { status: 500 });
  }
}
