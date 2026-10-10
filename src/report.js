// Turns axe-core's raw (deterministic, real) violations into a client-
// readable report: a plain-English explanation of why each issue matters,
// plus a concrete suggested code fix for the actual HTML we found. The AI
// is only asked to EXPLAIN and FIX violations axe-core already confirmed —
// never asked to invent findings on its own — so we keep axe's reliability
// and add the AI's clarity on top, instead of trusting the AI to detect
// issues from scratch (which is how hallucinated findings creep in).

const { callAi } = require("./ai");

const MAX_NODES_PER_VIOLATION = 2;
const MAX_VIOLATIONS_PER_CALL = 15; // keeps the prompt (and cost) bounded

function buildUserText(violations) {
  const capped = violations.slice(0, MAX_VIOLATIONS_PER_CALL);
  const blocks = capped.map((v) => {
    const nodes = v.nodes.slice(0, MAX_NODES_PER_VIOLATION).map((n) => ({
      selector: n.target.join(" "),
      html: n.html,
    }));
    return [
      `ID: ${v.id}`,
      `IMPACT: ${v.impact}`,
      `RULE: ${v.help}`,
      `EXAMPLE_HTML:`,
      ...nodes.map((n) => `  ${n.selector} -> ${n.html}`),
    ].join("\n");
  });
  return blocks.join("\n\n");
}

const SYSTEM_PROMPT = `You are an accessibility consultant writing a report for a non-technical client (a small business owner or web agency), about real WCAG violations that an automated scanner (axe-core) already confirmed on their live website. You are NOT finding new issues — only explaining and fixing the ones given to you.

For EACH violation given, respond in exactly this format, one block per violation, in the same order given:

VIOLATION: <the ID exactly as given>
EXPLAIN: <one or two plain-English sentences on why this matters for real users — no jargon, as if explaining to a shop owner, not a developer>
FIX:
\`\`\`html
<the corrected version of the EXAMPLE_HTML for this violation, fixing the issue, changing nothing else>
\`\`\`

Keep EXPLAIN genuinely non-technical. Base the FIX only on the EXAMPLE_HTML given for that violation — don't invent surrounding markup you weren't shown.`;

/**
 * Calls the AI once for the whole batch of violations and parses the
 * structured reply back into a map keyed by violation id, so the caller
 * can merge it with axe's own metadata (impact, help text, node count).
 */
async function explainAndFix(violations, aiConfig) {
  if (!violations.length) return {};
  const userText = buildUserText(violations);
  const reply = await callAi({ ...aiConfig, system: SYSTEM_PROMPT, userText });
  return parseReply(reply);
}

function parseReply(reply) {
  const byId = {};
  const blocks = reply.split(/^VIOLATION:\s*/im).filter(Boolean);
  for (const block of blocks) {
    const idMatch = block.match(/^(\S+)/);
    if (!idMatch) continue;
    const id = idMatch[1].trim();
    const explainMatch = block.match(/EXPLAIN:\s*([\s\S]*?)(?=\nFIX:|$)/i);
    const fixMatch = block.match(/```html\n?([\s\S]*?)```/i);
    byId[id] = {
      explain: explainMatch ? explainMatch[1].trim() : "",
      fix: fixMatch ? fixMatch[1].trim() : null,
    };
  }
  return byId;
}

module.exports = { explainAndFix };
