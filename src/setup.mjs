import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { codexHome, catalogPath, writeCatalog } from "./catalog.mjs";
import { newLocalToken, writeSettings, settingsPath } from "./config.mjs";
import { installAutostart, uninstallAutostart } from "./autostart.mjs";

const MARKER = "# MOMO_CODEX_SWITCH_MANAGED";
const VERIFIED_CODEX_MODELS = new Set(["ox-alpha-free"]);

function authPath(env) { return join(codexHome(env), "auth.json"); }
function configPath(env) { return join(codexHome(env), "config.toml"); }
function backup(file) { if (existsSync(file)) copyFileSync(file, `${file}.momo-switch.bak`); }

function managedConfig(catalog, port, defaultModel) {
  return `${MARKER}\nmodel_provider = "momo-switch"\nmodel = "${defaultModel}"\nmodel_reasoning_effort = "high"\nmodel_catalog_json = "${catalog.replace(/\\/g, "/")}"\ndisable_response_storage = false\n\n[model_providers.momo-switch]\nname = "MOMO Codex Bridge"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nenv_key = "OPENAI_API_KEY"\n`;
}

function isCodexCandidate(model) {
  const status = model.agent_status || model.agentStatus || "experimental";
  return model?.id && status !== "hidden" && status !== "image" && status !== "video";
}

export async function setup({ apiKey, endpoint, port = 18789, autostart = true, desktopAliases = true, fetchImpl = fetch, env = process.env } = {}) {
  if (!apiKey) throw new Error("--api-key is required.");
  const localToken = newLocalToken();
  const settings = {
    apiKey,
    endpoint: (endpoint || "https://momoapi.us").replace(/\/$/, ""),
    port,
    localToken,
    autostart: Boolean(autostart),
    desktopAliases: Boolean(desktopAliases),
  };
  const modelsResponse = await fetchImpl(`${settings.endpoint}/agent/catalog`, { headers: { authorization: `Bearer ${apiKey}` } });
  let models;
  if (modelsResponse.ok) {
    const payload = await modelsResponse.json();
    models = payload.data || payload.models || [];
  } else {
    const fallback = await fetchImpl(`${settings.endpoint}/v1/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!fallback.ok) throw new Error(`MOMO model catalog request failed (${fallback.status}).`);
    const payload = await fallback.json();
    models = (payload.data || []).map((model) => ({
      ...model,
      agent_status: VERIFIED_CODEX_MODELS.has(model.id) ? "stable" : "experimental",
    }));
  }
  const config = configPath(env);
  const auth = authPath(env);
  const catalog = catalogPath(env);
  backup(config); backup(auth); backup(catalog);
  const previous = existsSync(config) ? readFileSync(config, "utf8") : "";
  if (previous.includes(MARKER)) throw new Error("MOMO Codex Switch is already configured. Run rollback before setup again.");
  const candidates = models.filter(isCodexCandidate);
  const defaultModel = candidates.find((model) => (model.agent_status || model.agentStatus) === "stable")?.id || candidates[0]?.id;
  if (!defaultModel) throw new Error("MOMO returned no Codex-compatible models.");
  writeCatalog(models, env, { includeDesktopAliases: desktopAliases });
  writeFileSync(config, `${managedConfig(catalog, port, defaultModel)}${previous ? `\n${previous}` : ""}`);
  writeFileSync(auth, `${JSON.stringify({ OPENAI_API_KEY: localToken }, null, 2)}\n`);
  const settingsFile = writeSettings(settings, env);

  let autostartResult = null;
  if (autostart) {
    try {
      autostartResult = installAutostart(settings, { env });
    } catch (err) {
      autostartResult = { installed: false, error: err.message };
    }
  }

  return { catalog, settingsFile, models: models.length, defaultModel, config, auth, localToken, autostart: autostartResult };
}

export function rollback(env = process.env) {
  const files = [configPath(env), authPath(env), catalogPath(env)];
  const restored = [];
  for (const file of files) {
    const source = `${file}.momo-switch.bak`;
    if (!existsSync(source)) continue;
    copyFileSync(source, file);
    restored.push(file);
  }
  return restored;
}

export function uninstall({ env = process.env, removeKey = false } = {}) {
  uninstallAutostart({ env });
  const restored = rollback(env);
  let keyRemoved = false;
  if (removeKey) {
    const file = settingsPath(env);
    if (existsSync(file)) {
      unlinkSync(file);
      keyRemoved = true;
    }
  }
  return { uninstalled: true, restoredFiles: restored, keyRemoved };
}
