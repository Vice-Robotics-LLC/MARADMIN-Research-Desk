const PARSER_VERSION = "plain-v1";
export const MAX_PARSED_SECTIONS = 200;
export const MAX_RELATIONS = 50;

export function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–"
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, token: string) => {
    if (token[0] === "#") {
      const hex = token[1]?.toLowerCase() === "x";
      const code = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : whole;
    }
    return named[token.toLowerCase()] ?? whole;
  });
}

export function htmlToPlainText(html: string): string {
  const withoutActive = html
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|section|article|main)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutActive)
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMARADMINMessage(html: string, expectedNumber: string): { header: string; body: string } {
  if (!/^\d{3,4}\/\d{2}$/.test(expectedNumber)) throw new Error("invalid_expected_number");
  const plain = htmlToPlainText(html);
  const escaped = expectedNumber.replace("/", "\\/");
  const start = plain.search(/\bGENTEXT\/(?:REMARKS|REMAKS|RMKS)\//i);
  if (start < 0) throw new Error("body_marker_missing");
  const headerPrefix = plain.slice(0, start);
  const identityPattern = new RegExp(`\\bMARADMIN\\s+${escaped}\\b`, "gi");
  const identityMatches = [...headerPrefix.matchAll(identityPattern)];
  if (!identityMatches.length) {
    if (/\bALMAR\s+\d{1,4}\/\d{2}\b/i.test(headerPrefix)) throw new Error("not_maradmin");
    throw new Error("message_number_mismatch");
  }
  const header = headerPrefix.slice(identityMatches.at(-1)!.index).trim();
  const bodyWithTerminator = plain.slice(start).replace(/^.*?GENTEXT\/(?:REMARKS|REMAKS|RMKS)\//i, "");
  const terminator = /(?<!:)\/\/(?=[ \t]*(?:\n|$))/.exec(bodyWithTerminator);
  const body = (terminator ? bodyWithTerminator.slice(0, terminator.index) : bodyWithTerminator).trim();
  if (body.length < 40) throw new Error("body_too_short");
  return { header, body };
}

export function extractMARADMINBody(html: string, expectedNumber: string): string {
  return parseMARADMINMessage(html, expectedNumber).body;
}

export function extractMARADMINRelationScope(html: string, expectedNumber: string): string {
  const message = parseMARADMINMessage(html, expectedNumber);
  return `${message.header}\n${message.body}`;
}

export type ParsedSection = { ordinal: number; marker: string | null; text: string };

export function splitSections(body: string): ParsedSection[] {
  const lines = body.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (const line of lines) {
    const match = line.match(/^(\d+(?:\.[a-z0-9]+)*\.)\s*(.*)$/i);
    if (match) {
      if (current) sections.push(current);
      if (sections.length >= MAX_PARSED_SECTIONS) { current = null; break; }
      current = { ordinal: sections.length, marker: match[1] ?? null, text: (match[2] ?? "").trim() };
    } else if (current) {
      current.text = `${current.text} ${line}`.trim();
    } else {
      current = { ordinal: sections.length, marker: null, text: line };
    }
  }
  if (current && sections.length < MAX_PARSED_SECTIONS) sections.push(current);
  return sections.filter((section) => section.text.length > 0).map((section, ordinal) => ({ ...section, ordinal }));
}

export function maskContacts(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/(?:\+?1[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}\b/g, "[phone redacted]")
    .replace(/\b(?:1\d{10}|\d{10})\b/g, "[phone redacted]")
    .replace(/\bDSN\s*\d{3}[ .-]\d{4}\b/gi, "[phone redacted]")
    .replace(/\b(?:phone|telephone|call|contact|dsn)\s*[:.]?\s*\d{7}\b/gi, "[phone redacted]")
    .replace(/(?<![\d,])\d{3}[- ]\d{4}\b(?!,\d)/g, "[phone redacted]")
    .replace(/\b(?:ext(?:ension)?|x)\s*[:.]?\s*\d{2,6}\b/gi, "[extension redacted]")
    .replace(/\b\d{1,6}\s+(?:(?:[A-Z][A-Za-z0-9.'-]*|[A-Z0-9]{2,})\s+){1,4}(?:St(?:reet)?|Rd|Road|Ave(?:nue)?|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Hwy|Highway)\.?\b/g, "[address redacted]");
}

export function extractRelations(body: string, sourceNumber?: string): Array<{ targetNumber: string; relationType: "references" | "changes" | "cancels" | "supersedes"; evidence: string }> {
  const relations = new Map<string, { targetNumber: string; relationType: "references" | "changes" | "cancels" | "supersedes"; evidence: string }>();
  const normalized = body.replace(/\bMARADMIN\s*\n\s*(\d{3,4}\/\d{2})\b/gi, "MARADMIN $1");
  for (const line of normalized.split(/\n+/)) {
    for (const match of line.matchAll(/\bMARADMIN\s+(\d{3,4}\/\d{2})\b/gi)) {
      const lower = line.toLowerCase();
      const relationType = /cancel/.test(lower) ? "cancels" : /supersed/.test(lower) ? "supersedes" : /change\s+\d+/.test(lower) ? "changes" : "references";
      const targetNumber = match[1]!;
      if (targetNumber === sourceNumber) continue;
      relations.set(`${relationType}:${targetNumber}`, { targetNumber, relationType, evidence: maskContacts(line).slice(0, 500) });
      if (relations.size >= MAX_RELATIONS) return [...relations.values()];
    }
  }
  return [...relations.values()];
}

export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export { PARSER_VERSION };
