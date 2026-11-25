// Syntax check for the Worker and the inline browser script, without a bundler.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "convert-check-"));
const files = [];

const worker = readFileSync("src/index.js", "utf8")
  .replace(/^import \{ WorkflowEntrypoint \}.*$/m, "class WorkflowEntrypoint {}")
  .replace(/^import (\w+) from "\.\/.*";$/gm, 'const $1 = "";');
files.push(["worker.mjs", worker]);
files.push(["ffworker.js", readFileSync("src/ffworker.js.txt", "utf8")]);
files.push(["pages.mjs", readFileSync("src/pages.js", "utf8")]);
const html = readFileSync("src/ui.html", "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error("no inline script found in ui.html");
files.push(["ui.js", scripts.join("\n")]);
for (const k of ["SITEKEY", "PRESET", "TITLE", "JSONLD", "H1", "LEAD", "EXAMPLE", "FAQ", "LINKS"])
  if (!html.includes(`__${k}__`)) throw new Error(`ui.html lost the __${k}__ placeholder`);

for (const [name, src] of files) {
  const path = join(dir, name);
  writeFileSync(path, src);
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("ok", name);
}
