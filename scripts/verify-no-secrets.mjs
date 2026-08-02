import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const ignoredFiles = new Set(["pnpm-lock.yaml", "verify-no-secrets.mjs"]);
const textExtensions = new Set([".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ps1", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[oprs]_[0-9A-Za-z]{36,255}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
  /\bsk_live_[0-9A-Za-z]{16,}\b/,
];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (entry.isFile() && !ignoredFiles.has(entry.name) && (textExtensions.has(extname(entry.name)) || entry.name.startsWith(".env"))) files.push(path);
  }
  return files;
}

const findings = [];
for (const path of await collect(root)) {
  const text = await readFile(path, "utf8");
  if (patterns.some((pattern) => pattern.test(text))) findings.push(relative(root, path));
}

if (findings.length > 0) {
  console.error("Potential committed credential material found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log("Secret-pattern check passed.");
}
