import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export function logPath(env = process.env) {
  const root = env.MOMO_BRIDGE_HOME || join(homedir(), ".momo-codex-bridge");
  return join(root, "bridge.log");
}

export function logRequest({ method, url, model, status, elapsedMs, error, ip }, env = process.env) {
  try {
    const target = logPath(env);
    mkdirSync(dirname(target), { recursive: true });
    const timestamp = new Date().toISOString();
    const modelTag = model ? ` [${model}]` : "";
    const statusTag = status != null ? ` -> HTTP ${status}` : "";
    const timeTag = elapsedMs != null ? ` (${elapsedMs}ms)` : "";
    const errorTag = error ? ` ERROR: ${error}` : "";
    const ipTag = ip ? ` [${ip}]` : "";
    const line = `[${timestamp}]${ipTag} ${method} ${url}${modelTag}${statusTag}${timeTag}${errorTag}\n`;
    appendFileSync(target, line, "utf8");
  } catch {}
}

export function readRecentLogs(lines = 100, env = process.env) {
  const target = logPath(env);
  if (!existsSync(target)) return [];
  try {
    const content = readFileSync(target, "utf8");
    const allLines = content.split(/\r?\n/).filter(Boolean);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}
