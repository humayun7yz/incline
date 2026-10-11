// Provider-agnostic AI calls — same pattern as Mark's VS Code extension,
// so switching providers later (or eventually self-hosting) doesn't require
// rewriting this layer. Anthropic (Claude) and any OpenAI-compatible API
// (OpenAI, DeepSeek) are both supported.

const https = require("https");

function defaultModelFor(provider) {
  switch (provider) {
    case "openai":
      return "gpt-4o";
    case "deepseek":
      return "deepseek-chat";
    default:
      return "claude-sonnet-4-6";
  }
}

function callOpenAiCompatible(provider, apiKey, model, system, userText) {
  const hostname = provider === "deepseek" ? "api.deepseek.com" : "api.openai.com";
  const body = JSON.stringify({
    model,
    max_tokens: 6000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
  });

  const options = {
    hostname,
    path: "/chat/completions",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Length": Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || "API error"));
          resolve(parsed.choices?.[0]?.message?.content || "(no text response)");
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function callClaude(apiKey, model, system, userText) {
  const body = JSON.stringify({
    model,
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content: userText }],
  });

  const options = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || "API error"));
          const textBlock = (parsed.content || []).find((b) => b.type === "text");
          resolve(textBlock ? textBlock.text : "(no text response)");
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function callAi({ provider, apiKey, model, system, userText }) {
  const resolvedModel = model && model.trim() ? model : defaultModelFor(provider);
  if (provider === "anthropic") {
    return callClaude(apiKey, resolvedModel, system, userText);
  }
  return callOpenAiCompatible(provider, apiKey, resolvedModel, system, userText);
}

module.exports = { callAi, defaultModelFor };
