import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const html = readFileSync(resolve(dist, "index.html"), "utf8");
const initialScripts = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.js)"/g)]
  .map((match) => match[1]))];

test("initial JavaScript stays within the desktop startup budget", () => {
  assert.ok(initialScripts.length, "Build output has no initial JavaScript");
  const contents = initialScripts.map((path) => readFileSync(resolve(dist, `.${path}`)));
  const bytes = contents.reduce((total, content) => total + content.length, 0);
  const gzipBytes = contents.reduce((total, content) => total + gzipSync(content).length, 0);
  assert.ok(bytes <= 400 * 1024, `Initial JavaScript is ${(bytes / 1024).toFixed(1)} KiB (budget: 400 KiB)`);
  assert.ok(gzipBytes <= 125 * 1024, `Compressed initial JavaScript is ${(gzipBytes / 1024).toFixed(1)} KiB (budget: 125 KiB)`);
});
