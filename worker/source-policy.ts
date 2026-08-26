const OFFICIAL_HOSTS = new Set(["marines.mil", "www.marines.mil"]);
const OFFICIAL_PREFIX = "/News/Messages/Messages-Display/";
export const MAX_SOURCE_BYTES = 5_000_000;

export function validateOfficialURL(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || !OFFICIAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("source_not_official");
  }
  if (!url.pathname.startsWith(OFFICIAL_PREFIX)) throw new Error("source_path_not_allowed");
  if (url.username || url.password) throw new Error("source_credentials_not_allowed");
  url.hash = "";
  return url;
}

export async function fetchOfficialHTML(value: string, fetcher: typeof fetch = fetch): Promise<{ html: string; finalURL: string }> {
  let url = validateOfficialURL(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html",
          "user-agent": "MARADMINResearchDesk/0.1 (+https://github.com/Vice-Robotics-LLC/MARADMIN-Research-Desk)"
        }
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw new Error("unsafe_redirect");
        url = validateOfficialURL(new URL(location, url).href);
        continue;
      }
      if (response.status === 403) throw new Error("source_fetch_blocked");
      if (!response.ok) throw new Error(`source_http_${response.status}`);
      const type = response.headers.get("content-type") ?? "";
      if (!/^text\/html\b/i.test(type.trim())) throw new Error("unsupported_content_type");
      const charset = /;\s*charset\s*=\s*"?([^;"\s]+)"?/i.exec(type)?.[1] ?? "utf-8";
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_SOURCE_BYTES) throw new Error("source_too_large");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("source_empty");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > MAX_SOURCE_BYTES) {
          await reader.cancel();
          throw new Error("source_too_large");
        }
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let decoder: TextDecoder;
      try { decoder = new TextDecoder(charset); }
      catch { throw new Error("unsupported_charset"); }
      return { html: decoder.decode(bytes), finalURL: validateOfficialURL(response.url || url.href).href };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("unsafe_redirect");
}
