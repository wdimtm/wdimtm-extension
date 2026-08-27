/**
 * Minimal PromptaaS-compatible gateway for local integration tests.
 * POST /v1/agents/:agentId/run  → { explanation, followUps }
 *
 * Usage: node scripts/promptaas-mock-server.mjs
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && /^\/v1\/agents\/[^/]+\/run$/.test(req.url || "")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json" }));
      return;
    }
    const input = body.input || body;
    const selection = input.selection || "";
    const mode = input.mode || "explain";
    const lens = input.lens?.id || "general";
    const explanation = [
      `**PromptaaS mock** (${mode}, lens=${lens})`,
      "",
      `Understood selection (${selection.split(/\s+/).filter(Boolean).length} words):`,
      `“${selection.slice(0, 200)}${selection.length > 200 ? "…" : ""}”`,
      "",
      input.memories?.length
        ? `Attached ${input.memories.length} memor(ies).`
        : "No memories attached.",
    ].join("\n");

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        explanation,
        followUps: ["Explain more", "Why it matters", "Verify", "Remember this"],
        runtime: "promptaas-mock",
      })
    );
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`PromptaaS mock: http://127.0.0.1:${PORT}`);
  console.log(`Try: POST /v1/agents/wdimtm-explainer/run`);
});
