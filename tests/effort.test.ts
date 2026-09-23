// `--fast`: reasoning effort is sent only for the read step, and a provider that rejects it is
// retried without it (once) and never sent it again.
import { describe, expect, it } from "vitest";
import { createXaiTransport } from "@jevx/gemini";

const ok = (text: string) => new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200 });

describe("reasoning effort", () => {
  it("is sent when asked, and dropped for good if the model rejects it", async () => {
    const bodies: Record<string, unknown>[] = [];
    let reject = true;
    const fetch = (async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(b);
      if (b.reasoning && reject) return new Response(JSON.stringify({ error: "Argument not supported on this model: reasoning.effort" }), { status: 400 });
      return ok("{}");
    }) as typeof globalThis.fetch;
    const t = createXaiTransport({ apiKey: "k", baseURL: "https://api.x.ai/v1", fetch }).transport!;
    await t.generate({ systemInstruction: "s", prompt: "p", schema: {}, effort: "low" });
    expect(bodies[0]!.reasoning).toEqual({ effort: "low" });
    expect(bodies[1]!.reasoning).toBeUndefined(); // retried without it
    await t.generate({ systemInstruction: "s", prompt: "p", schema: {}, effort: "low" });
    expect(bodies).toHaveLength(3);
    expect(bodies[2]!.reasoning).toBeUndefined(); // remembered
    reject = false;
  });

  it("is not sent unless asked", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return ok("{}");
    }) as typeof globalThis.fetch;
    const t = createXaiTransport({ apiKey: "k", baseURL: "https://api.x.ai/v1", fetch }).transport!;
    await t.generate({ systemInstruction: "s", prompt: "p", schema: {} });
    expect(bodies[0]!.reasoning).toBeUndefined();
  });

  it("other 400s are not swallowed", async () => {
    const fetch = (async () => new Response(JSON.stringify({ error: "bad schema" }), { status: 400 })) as typeof globalThis.fetch;
    const t = createXaiTransport({ apiKey: "k", baseURL: "https://api.x.ai/v1", fetch }).transport!;
    await expect(t.generate({ systemInstruction: "s", prompt: "p", schema: {}, effort: "low" })).rejects.toThrow(/bad schema/);
  });
});
