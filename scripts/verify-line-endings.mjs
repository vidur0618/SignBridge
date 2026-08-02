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
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const textNames = new Set([
  ".dockerignore",
  ".editorconfig",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
]);

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(path)));
    } else if (entry.isFile() && (textExtensions.has(extname(entry.name)) || textNames.has(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];
for (const path of await collect(root)) {
  const bytes = await readFile(path);
  if (bytes.includes(Buffer.from("\r\n"))) {
    violations.push(relative(root, path));
  }
}

if (violations.length > 0) {
  console.error("CRLF line endings found. SignBridge text files must use LF on every platform:");
  for (const path of violations) {
    console.error(`- ${path}`);
  }
  process.exitCode = 1;
} else {
  console.log("Line-ending check passed (LF on all repository text files).");
}
