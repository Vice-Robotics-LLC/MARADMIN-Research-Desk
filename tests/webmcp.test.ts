import { describe, expect, it, vi } from "vitest";
import { getWebMcpToolDefinitions, registerWebMcpTools, type WebMcpTool } from "../src/webmcp";

const EXPECTED_NAMES = [
  "search_maradmins",
  "get_maradmin_evidence",
  "find_maradmin_revisions",
  "evaluate_maradmin_eligibility",
  "open_official_source"
] as const;

describe("MARADMIN WebMCP contract", () => {
  it("exposes the expected stable tool names exactly once", () => {
    const tools = getWebMcpToolDefinitions();
    expect(tools.map((tool) => tool.name)).toEqual([...EXPECTED_NAMES]);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(EXPECTED_NAMES.length);
  });

  it("defines bounded object schemas with closed input fields", () => {
    for (const tool of getWebMcpToolDefinitions()) {
      const schema = tool.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.type, tool.name).toBe("object");
      expect(schema.additionalProperties, tool.name).toBe(false);
      expect(schema.properties, tool.name).toBeDefined();
      expect(schema.required, tool.name).toBeInstanceOf(Array);
      expect((schema.required ?? []).length, tool.name).toBeGreaterThan(0);
    }
  });

  it("marks every source-derived result as read-only and untrusted", () => {
    const tools = getWebMcpToolDefinitions();
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations.destructiveHint, tool.name).toBe(false);
      expect(tool.annotations.idempotentHint, tool.name).toBe(true);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
    }
    for (const name of EXPECTED_NAMES.slice(0, 4)) {
      expect(tools.find((tool) => tool.name === name)?.annotations.untrustedContentHint, name).toBe(true);
    }
    expect(tools.find((tool) => tool.name === "open_official_source")?.annotations.untrustedContentHint).toBe(true);
  });

  it("rejects malformed inputs before making API calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch_must_not_run"));
    const tools = Object.fromEntries(getWebMcpToolDefinitions().map((tool) => [tool.name, tool])) as Record<string, WebMcpTool>;

    try {
    await expect(tools.search_maradmins.execute({ query: "" })).rejects.toThrow(TypeError);
    await expect(tools.search_maradmins.execute({ query: "bonus", unexpected: true })).rejects.toThrow(TypeError);
    for (const limit of ["5", null, 1.5, 0, 21]) {
      await expect(tools.search_maradmins.execute({ query: "bonus", limit })).rejects.toThrow("Invalid limit.");
    }
    for (const year of ["2026", null, 2026.5, 2002, 2101]) {
      await expect(tools.search_maradmins.execute({ query: "bonus", year })).rejects.toThrow("Invalid year.");
    }
    await expect(tools.get_maradmin_evidence.execute({ documentID: "../secret" })).rejects.toThrow(TypeError);
    await expect(tools.find_maradmin_revisions.execute({ documentID: "" })).rejects.toThrow(TypeError);
    await expect(tools.evaluate_maradmin_eligibility.execute({ documentIDs: [] })).rejects.toThrow(TypeError);
    await expect(tools.evaluate_maradmin_eligibility.execute({ documentIDs: ["valid", 7] })).rejects.toThrow(TypeError);
    for (const input of [
      { documentIDs: ["valid"], rank: "Sergeant" },
      { documentIDs: ["valid"], mos: "30A3" },
      { documentIDs: ["valid"], component: "unknown" },
      { documentIDs: ["valid"], zone: "Z" },
      { documentIDs: ["valid"], yearsOfService: 5.5 },
      { documentIDs: ["valid"], yearsOfService: 61 }
    ]) {
      await expect(tools.evaluate_maradmin_eligibility.execute(input)).rejects.toThrow(TypeError);
    }
    await expect(tools.open_official_source.execute({ documentID: "https://example.com" })).rejects.toThrow(TypeError);
    expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("registers every tool when Model Context is available and degrades cleanly when it is absent", async () => {
    const registered: WebMcpTool[] = [];
    const pageDocument = {
      modelContext: {
        registerTool: async (tool: WebMcpTool) => {
          registered.push(tool);
        }
      }
    } as unknown as Document & { modelContext?: { registerTool(tool: WebMcpTool): Promise<unknown> | unknown } };

    expect(await registerWebMcpTools(pageDocument)).toEqual([...EXPECTED_NAMES]);
    expect(registered.map((tool) => tool.name)).toEqual([...EXPECTED_NAMES]);
    expect(await registerWebMcpTools({} as Document & { modelContext?: { registerTool(tool: WebMcpTool): Promise<unknown> | unknown } })).toEqual([]);
  });
});
