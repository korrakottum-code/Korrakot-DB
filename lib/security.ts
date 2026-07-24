const META_MEDIA_HOST_SUFFIXES = ["facebook.com", "fbcdn.net", "fbsbx.com"];

export function isAllowedMetaMediaUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl.length > 2_048) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;

    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return META_MEDIA_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

export function isSameOriginRequest(
  requestUrl: string,
  origin: string | null,
  hostHeader?: string | null
): boolean {
  if (!origin) return false;
  try {
    const clientOrigin = new URL(origin).origin;
    if (clientOrigin === new URL(requestUrl).origin) return true;
    if (hostHeader) {
      const scheme = new URL(requestUrl).protocol;
      if (clientOrigin === new URL(`${scheme}//${hostHeader}`).origin) return true;
    }
    return false;
  } catch {
    return false;
  }
}
