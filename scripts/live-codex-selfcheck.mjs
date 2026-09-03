import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createMomoSwitch } from "../src/server.mjs";

const modelIndex = process.argv.indexOf("--model");
const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : "";
if (!model) throw new Error("Usage: node scripts/live-codex-selfcheck.mjs --model <model-id>");
if (!process.env.MOMO_API_KEY) throw new Error("MOMO_API_KEY is required for the live self-check.");

const prompt = `\
请进行一次完整的自检，通过实际执行来验证你作为 Codex agent 的工具能力是否完整可用。
所有测试文件都放在当前目录下的 selfcheck_test 文件夹里（没有就创建），不要动其他任何文件。

请依次完成以下验证，每一步都真实执行工具，不要只描述：

1. 【exec_command 执行命令】用命令创建一个目录 selfcheck_test，再在里面创建一个文本文件 demo.txt，内容是 "tool check ok"

2. 【文件读写】读取 demo.txt 确认内容，然后追加一行 "second line"

3. 【apply_patch / 编辑能力】修改 demo.txt，把第一行改成 "TOOL CHECK PASSED"

4. 【搜索能力】用 rg 或系统搜索，统计 selfcheck_test 目录下有哪些文件，并报告文件数量

5. 【工具调用回环】执行一个能返回输出的命令（比如列出 selfcheck_test 里的文件），确认你能拿到命令的真实输出并理解它

6. 【多轮工具协作】删除 demo.txt，再新建两个文件 a.txt 和 b.txt，用一条命令把 a.txt 内容写入 b.txt，最后读取 b.txt 确认

最后，给出一份清晰的《自检报告》，包含：

- 每个工具（exec_command / 文件读写 / apply_patch / 搜索 / 多轮调用）是否真实可用
- 你实际执行了哪些命令、结果是什么
- 有无任何工具调用失败或异常`;

const root = mkdtempSync(join(tmpdir(), "momo-live-codex-"));
const codexHome = join(root, ".codex");
const workdir = join(root, "work");
const localToken = "momo-live-selfcheck-local-token";
const reportPath = join(root, "final-report.txt");

function bundledTemplate() {
  const bundled = JSON.parse(execFileSync("codex", ["debug", "models", "--bundled"], { encoding: "utf8" }));
  return structuredClone(bundled.models.find((item) => item.slug === "gpt-5.5") || bundled.models[0]);
}

function listFiles(directory, root = directory) {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(path, root));
    else results.push(relative(root, path).replaceAll("\\", "/"));
  }
  return results.sort();
}

await Promise.all([mkdir(codexHome, { recursive: true }), mkdir(workdir, { recursive: true })]);
const template = bundledTemplate();
template.slug = model;
template.display_name = `MOMO live self-check: ${model}`;
template.visibility = "list";
template.default_reasoning_level = "high";
writeFileSync(join(root, "catalog.json"), `${JSON.stringify({ models: [template] })}\n`);
writeFileSync(join(codexHome, "config.toml"), `model_provider = "momo-switch"\nmodel = "${model}"\nmodel_catalog_json = "${join(root, "catalog.json").replace(/\\/g, "/")}"\ndisable_response_storage = true\n\n[model_providers.momo-switch]\nname = "MOMO live self-check"\nbase_url = "http://127.0.0.1:18789/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n`);
writeFileSync(join(codexHome, "auth.json"), `${JSON.stringify({ OPENAI_API_KEY: localToken })}\n`);

const server = createMomoSwitch({ endpoint: process.env.MOMO_API_ENDPOINT || "https://momoapi.us", apiKey: process.env.MOMO_API_KEY, localToken, host: "127.0.0.1", port: 18789 });
await new Promise((resolve, reject) => server.once("error", reject).listen(18789, "127.0.0.1", resolve));

try {
  const transcript = await new Promise((resolve, reject) => {
    const child = spawn("codex", ["exec", "--json", "--ephemeral", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-m", model, "--output-last-message", reportPath, prompt], {
      cwd: workdir,
      env: { ...process.env, CODEX_HOME: codexHome, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 360_000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      code === 0 ? resolve(output) : reject(new Error(`Codex exited ${code}: ${output.slice(-4000)}`));
    });
  });

  const report = readFileSync(reportPath, "utf8");
  const files = listFiles(workdir);
  const expected = ["selfcheck_test/a.txt", "selfcheck_test/b.txt"];
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected test files: ${JSON.stringify(files)}; report=${report.slice(0, 1200)}; transcript=${transcript.slice(-1200)}`);
  }
  if (!readFileSync(join(workdir, "selfcheck_test", "b.txt"), "utf8").trim()) throw new Error("b.txt is empty; the final read/write loop did not complete.");
  if (/DSML|<tool_calls>|<invoke\b/i.test(`${transcript}\n${report}`)) throw new Error("Tool-call markup leaked as text instead of executing.");
  const reportQuality = report.trim().length >= 40 && /(tool|工具|exec|file|文件|selfcheck|self-check)/i.test(report);
  console.log(JSON.stringify({
    result: "MOMO_LIVE_CODEX_TOOLCHAIN_OK",
    model,
    files,
    reportQuality: reportQuality ? "complete" : "brief",
    report: report.slice(0, 1200),
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  // Windows can retain a short-lived handle after Codex exits; cleanup must not
  // turn a completed agent verification into a false failure.
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); } catch { /* best effort */ }
}
