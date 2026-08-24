import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { consumeApiRateLimit } from "@/lib/rate-limit";
import { isAllowedMetaMediaUrl } from "@/lib/security";
import { requireInternalApiAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
// ที่ใหญ่สุดที่ใช้จริงคือ modal preview (max-w-2xl ~672px) ที่เหลือเป็นแค่ thumbnail เล็กๆ ในกริด
// เกิน 800px แค่เปลืองแบนด์วิดท์ระหว่าง Edge กับ Function โดยไม่มีใครมองเห็นความคมชัดที่เพิ่มขึ้น
const MAX_DIMENSION = 800;
const JPEG_QUALITY = 80;

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

    let outputBody: Buffer = Buffer.from(buffer);
    let outputContentType = contentType;
    // ย่อเฉพาะฟอร์แมตภาพนิ่งทั่วไป — เลี่ยง gif เพราะย่อแบบนี้จะเหลือแค่เฟรมเดียว เสียแอนิเมชัน
    if (contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp") {
      try {
        outputBody = await sharp(outputBody)
          .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer();
        outputContentType = "image/jpeg";
      } catch {
        // ย่อไม่สำเร็จ (ไฟล์เพี้ยน ฯลฯ) — ส่งต้นฉบับแทนดีกว่าทำรูปทั้งอันหาย
      }
    }

    // Buffer<ArrayBufferLike> ไม่ตรงกับ BodyInit ใน type defs ปัจจุบัน (ArrayBufferLike vs ArrayBuffer) —
    // ห่อเป็น Uint8Array ธรรมดาให้ตรงชนิดแทน ค่าไบต์เหมือนเดิมทุกประการ
    return new NextResponse(new Uint8Array(outputBody), {
      headers: {
        "Content-Type": outputContentType,
        // 7 วัน — thumbnail ครีเอทีฟแทบไม่เปลี่ยน ยืด cache ฝั่ง browser ลดจำนวนครั้งที่ต้องยิงเข้า
        // origin ซ้ำสำหรับคนเดิม (ยังเป็น private เหมือนเดิม ไม่กระทบการเช็คสิทธิ์)
        "Cache-Control": "private, max-age=604800, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("error", { status: 500 });
  }
}
