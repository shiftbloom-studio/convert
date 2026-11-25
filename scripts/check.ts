// Syntax check for the browser code: the ffmpeg worker and the inline script in ui.html.
// The Worker itself is TypeScript and is checked by tsc (npm run check runs it first).
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "convert-check-"));
const files: [string, string][] = [];

files.push(["ffworker.js", readFileSync("src/ffworker.js.txt", "utf8")]);
const html = readFileSync("src/ui.html", "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error("no inline script found in ui.html");
files.push(["ui.js", scripts.join("\n")]);
if (!html.includes("__SITEKEY__")) throw new Error("ui.html lost the __SITEKEY__ placeholder");

for (const [name, src] of files) {
  const path = join(dir, name);
  writeFileSync(path, src);
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("ok", name);
}
