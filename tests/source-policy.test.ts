import { describe, expect, it } from "vitest";
import { fetchOfficialHTML, MAX_SOURCE_BYTES, validateOfficialURL } from "../worker/source-policy";

const officialURL = "https://www.marines.mil/News/Messages/Messages-Display/123456/";

describe("official source policy", () => {
  it("accepts only the canonical official HTTPS path and removes fragments", () => {
    expect(validateOfficialURL(`${officialURL}#section`).href).toBe(officialURL);
    expect(validateOfficialURL(officialURL.replace("www.", "")).hostname).toBe("marines.mil");
  });

  it.each([
    ["http://www.marines.mil/News/Messages/Messages-Display/1/", "source_not_official"],
    ["https://example.com/News/Messages/Messages-Display/1/", "source_not_official"],
    ["https://127.0.0.1/News/Messages/Messages-Display/1/", "source_not_official"],
    ["https://www.marines.mil:8443/News/Messages/Messages-Display/1/", "source_not_official"],
    ["https://www.marines.mil/Other/1/", "source_path_not_allowed"],
    ["https://user:password@www.marines.mil/News/Messages/Messages-Display/1/", "source_credentials_not_allowed"]
  ])("rejects unsafe URL %s", (value, error) => {
    expect(() => validateOfficialURL(value)).toThrow(error);
  });

  it("follows a bounded redirect only when the destination remains official", async () => {
    let calls = 0;
    const result = await fetchOfficialHTML(officialURL, async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 302, headers: { location: `${officialURL}next` } });
      return new Response("<html>official</html>", { headers: { "content-type": "text/html" } });
    });

    expect(calls).toBe(2);
    expect(result.html).toContain("official");
    expect(result.finalURL).toBe(`${officialURL}next`);
  });

  it("rejects a redirect to a non-official host", async () => {
    await expect(fetchOfficialHTML(officialURL, async () => new Response(null, {
      status: 302,
      headers: { location: "https://example.com/News/Messages/Messages-Display/1/" }
    }))).rejects.toThrow("source_not_official");
  });

  it("rejects redirect chains that exceed the maximum hop count", async () => {
    let calls = 0;
    await expect(fetchOfficialHTML(officialURL, async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `${officialURL}${calls}` }
      });
    })).rejects.toThrow("unsafe_redirect");
    expect(calls).toBe(4);
  });

  it("requires HTML and a readable body", async () => {
    await expect(fetchOfficialHTML(officialURL, async () => new Response("not html", {
      headers: { "content-type": "application/json" }
    }))).rejects.toThrow("unsupported_content_type");

    await expect(fetchOfficialHTML(officialURL, async () => new Response(null, {
      headers: { "content-type": "text/html" }
    }))).rejects.toThrow("source_empty");
  });

  it("decodes a declared HTML charset case-insensitively and defaults to UTF-8", async () => {
    const windows1252 = await fetchOfficialHTML(officialURL, async () => new Response(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), {
      headers: { "content-type": "Text/HTML ; Charset = \"windows-1252\"" }
    }));
    expect(windows1252.html).toBe("café");

    const utf8 = await fetchOfficialHTML(officialURL, async () => new Response("café", {
      headers: { "content-type": "text/html" }
    }));
    expect(utf8.html).toBe("café");
  });

  it("rejects a response over the declared byte limit", async () => {
    await expect(fetchOfficialHTML(officialURL, async () => new Response("small", {
      headers: {
        "content-type": "text/html",
        "content-length": String(MAX_SOURCE_BYTES + 1)
      }
    }))).rejects.toThrow("source_too_large");
  });

  it("rejects a streamed response that exceeds the byte limit", async () => {
    const chunk = new Uint8Array(MAX_SOURCE_BYTES);
    await expect(fetchOfficialHTML(officialURL, async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(new Uint8Array([33]));
        controller.close();
      }
    }), { headers: { "content-type": "text/html" } }))).rejects.toThrow("source_too_large");
  });
});
