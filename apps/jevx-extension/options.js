const $ = (id) => document.getElementById(id);
const PROVIDERS = ["gemini", "xai", "openrouter"];
const HINT = {
  gemini: ["auto", "Leave empty: JevX picks the newest Flash-Lite model your key can use (free tier friendly). Or type one, e.g. gemini-3.8-flash."],
  xai: ["grok-4.6", "Leave empty for grok-4.6."],
  openrouter: ["x-ai/grok-4.6", "Leave empty for x-ai/grok-4.6. Any OpenRouter model id works, e.g. anthropic/claude-sonnet-4.5 or a :free model."]
};
const KEYS = ["provider", "geminiKey", "xaiKey", "openrouterKey", "githubToken", "typesafeKey", "models"];
let models = {};

function showProvider() {
  const p = $("provider").value;
  document.querySelectorAll("[data-for]").forEach((el) => (el.hidden = el.dataset.for !== p));
  $("model").placeholder = HINT[p][0];
  $("model").value = models[p] ?? "";
  $("model-hint").textContent = HINT[p][1];
}
async function load() {
  const s = await chrome.storage.local.get([...KEYS, "model"]);
  models = s.models ?? (s.model ? { gemini: s.model } : {}); // older versions stored one model
  $("provider").value = s.provider ?? "gemini";
  $("key-gemini").value = s.geminiKey ?? "";
  $("key-xai").value = s.xaiKey ?? "";
  $("key-openrouter").value = s.openrouterKey ?? "";
  $("github").value = s.githubToken ?? "";
  $("typesafe").value = s.typesafeKey ?? "";
  showProvider();
}
const say = (t, bad) => { $("msg").textContent = t; $("msg").style.color = bad ? "var(--red)" : ""; setTimeout(() => ($("msg").textContent = ""), 3000); };

$("provider").addEventListener("change", () => { models[$("provider").value] ??= ""; showProvider(); });
$("model").addEventListener("input", () => (models[$("provider").value] = $("model").value.trim()));
$("save").addEventListener("click", async () => {
  const provider = $("provider").value;
  const keys = { geminiKey: $("key-gemini").value.trim(), xaiKey: $("key-xai").value.trim(), openrouterKey: $("key-openrouter").value.trim() };
  if (!keys[`${provider}Key`]) return say("Add the key for the provider you picked.", true);
  models[provider] = $("model").value.trim();
  await chrome.storage.local.set({ provider, ...keys, githubToken: $("github").value.trim(), typesafeKey: $("typesafe").value.trim(), models });
  await chrome.storage.local.remove("model");
  say("Saved. Open a GitHub repo and click the JevX button.");
});
$("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove([...KEYS, "model"]);
  models = {};
  await load();
  say("Keys removed.");
});
if (!PROVIDERS.includes($("provider").value)) $("provider").value = "gemini";
load();
