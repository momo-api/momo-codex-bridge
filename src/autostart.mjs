import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_PATH = join(__dirname, "..", "bin", "momo-codex-bridge.mjs");

export function autostartTarget(osPlatform = platform(), env = process.env) {
  if (osPlatform === "win32") {
    const appData = env.APPDATA || (env.USERPROFILE ? join(env.USERPROFILE, "AppData", "Roaming") : join(homedir(), "AppData", "Roaming"));
    return join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "momo-codex-bridge.cmd");
  }
  if (osPlatform === "darwin") {
    const home = env.HOME || homedir();
    return join(home, "Library", "LaunchAgents", "us.momoapi.codex-bridge.plist");
  }
  const home = env.HOME || homedir();
  return join(home, ".config", "systemd", "user", "momo-codex-bridge.service");
}

export function isAutostartInstalled(osPlatform = platform(), env = process.env) {
  return existsSync(autostartTarget(osPlatform, env));
}

export function installAutostart(settings, { osPlatform = platform(), env = process.env } = {}) {
  const target = autostartTarget(osPlatform, env);
  mkdirSync(dirname(target), { recursive: true });

  if (osPlatform === "win32") {
    const script = "@echo off\r\nstart \"\" /B node \"" + BIN_PATH + "\" serve > nul 2>&1\r\n";
    writeFileSync(target, script);
    return { installed: true, target, type: "startup_script" };
  }

  if (osPlatform === "darwin") {
    const plist = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>us.momoapi.codex-bridge</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>node</string>\n    <string>' + BIN_PATH + '</string>\n    <string>serve</string>\n  </array>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <true/>\n</dict>\n</plist>\n';
    writeFileSync(target, plist);
    return { installed: true, target, type: "launchd_plist" };
  }

  const service = "[Unit]\nDescription=MOMO Codex Bridge\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=node " + BIN_PATH + " serve\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n";
  writeFileSync(target, service);
  return { installed: true, target, type: "systemd_service" };
}

export function uninstallAutostart({ osPlatform = platform(), env = process.env } = {}) {
  const target = autostartTarget(osPlatform, env);
  if (existsSync(target)) {
    unlinkSync(target);
    return { uninstalled: true, target };
  }
  return { uninstalled: false, target };
}
