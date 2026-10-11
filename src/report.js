// Turns axe-core's raw (deterministic, real) violations into a client-
// readable report: a plain-English explanation of why each issue matters,
// plus a concrete suggested code fix for the actual HTML we found. The AI
// is only asked to EXPLAIN and FIX violations axe-core already confirmed —
// never asked to invent findings on its own — so we keep axe's reliability
// and add the AI's clarity on top, instead of trusting the AI to detect
// issues from scratch (which is how hallucinated findings creep in).

const { callAi } = require("./ai");

const MAX_NODES_PER_VIOLATION = 2;
const MAX_VIOLATIONS_PER_CALL = 8; // keeps the prompt (and cost) bounded — lower than before since each reply is now longer

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

const SYSTEM_PROMPT = `You are an accessibility consultant preparing a thorough, client-facing audit report, about real WCAG violations that an automated scanner (axe-core) already confirmed on a live website. You are NOT finding new issues — only explaining and fixing the ones given to you. The report goes to a mix of readers: a non-technical site owner AND the developer or agency who will implement the fix, so it needs to serve both, and it should read as a complete professional writeup for each issue — not a one-line summary.

For EACH violation given, respond in exactly this format, one block per violation, in the same order given:

VIOLATION: <the ID exactly as given>
EXPLAIN: <three to four plain-English sentences: what is actually wrong, which kinds of real users it blocks or hinders (e.g. a screen-reader user, someone with low vision, someone navigating by keyboard, someone with a cognitive disability), and a concrete example of what that experience is actually like for them — no jargon>
STEPS:
- <short, concrete, actionable step a developer takes to fix this>
- <a second, genuinely separate step>
- <a third step, if there is one>
- <a fourth step, only if genuinely needed — never pad to reach a count>
FIX:
\`\`\`html
<the corrected version of the EXAMPLE_HTML for this violation, fixing the issue, changing nothing else>
\`\`\`
RISK: <one to two sentences on why this is worth fixing beyond "it's nice to be accessible" — lost conversions, ADA/WCAG legal exposure, SEO impact, or brand reputation, whichever is genuinely most relevant to this specific violation>
ALSO: <one to two sentences on a broader option or consideration — an alternative approach, a related best practice, or what to check sitewide so this doesn't recur elsewhere>

Keep EXPLAIN genuinely non-technical, STEPS genuinely technical and specific, RISK grounded in real business consequences (not scare tactics or invented statistics), and ALSO forward-looking. Base the FIX only on the EXAMPLE_HTML given for that violation — don't invent surrounding markup you weren't shown. Every sentence must say something new — depth and specificity, never filler or repetition.`;

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
    const explainMatch = block.match(/EXPLAIN:\s*([\s\S]*?)(?=\nSTEPS:|\nFIX:|$)/i);
    const stepsMatch = block.match(/STEPS:\s*([\s\S]*?)(?=\nFIX:|$)/i);
    const fixMatch = block.match(/```html\n?([\s\S]*?)```/i);
    const riskMatch = block.match(/RISK:\s*([\s\S]*?)(?=\nALSO:|$)/i);
    const alsoMatch = block.match(/ALSO:\s*([\s\S]*?)$/i);

    const steps = stepsMatch
      ? stepsMatch[1]
          .split("\n")
          .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
          .filter(Boolean)
      : [];

    byId[id] = {
      explain: explainMatch ? explainMatch[1].trim() : "",
      steps,
      fix: fixMatch ? fixMatch[1].trim() : null,
      risk: riskMatch ? riskMatch[1].trim() : "",
      also: alsoMatch ? alsoMatch[1].trim() : "",
    };
  }
  return byId;
}

module.exports = { explainAndFix };
