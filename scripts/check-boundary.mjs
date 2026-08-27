/**
 * Reports (and, with --check, enforces) the core/host boundary.
 *
 * Core is the half of the codebase that must run unchanged in a Cloudflare
 * Worker as well as in a browser extension, so the test is not "does it use
 * chrome?" but "does it touch any host global at all" — chrome, document,
 * window, localStorage, navigator. String and comment bodies are stripped
 * first, because several files mention `chrome.storage.local` inside
 * translated UI copy and would otherwise be misfiled.
 *
 * The set is closed under imports: a pure module that imports a host-coupled
 * one is itself host-coupled. That closure is the whole point — it is what
 * stops the boundary decaying one convenient import at a time.
 *
 *   node scripts/check-boundary.mjs            # report
 *   node scripts/check-boundary.mjs --check    # exit 1 if core touches a host
 */

import fs from "node:fs";
import path from "node:path";
const all = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js") && !e.name.includes(".global.")) all.push(p);
  }
};
walk("extension/lib");
if (fs.existsSync("core")) walk("core");
// The runtimes moved into core/ (#95); the directory is gone, and walking it
// unconditionally crashed this script — and the unit test that runs it.
if (fs.existsSync("extension/runtime")) walk("extension/runtime");

const strip = (s) =>
  s
    .split("\n").map((l) => l.replace(/\/\/.*/, "")).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

const HOST = /\b(chrome|browser)\.[a-zA-Z]+[.(]|\bdocument\.|\bwindow\.|\blocalStorage\b|\bnavigator\./;
const usesHost = (f) => HOST.test(strip(fs.readFileSync(f, "utf8")));
const importsOf = (f) =>
  [...fs.readFileSync(f, "utf8").matchAll(/from "(\.[^"]+)"/g)]
    .map((m) => path.normalize(path.join(path.dirname(f), m[1])));
const lines = (l) => l.reduce((s, f) => s + fs.readFileSync(f, "utf8").split("\n").length, 0);

const direct = new Set(all.filter(usesHost));
const host = new Set(direct);
let changed = true;
while (changed) {
  changed = false;
  for (const f of all) {
    if (host.has(f)) continue;
    if (importsOf(f).some((d) => host.has(d))) { host.add(f); changed = true; }
  }
}
const core = all.filter((f) => !host.has(f));
const strict = process.argv.includes("--check");
console.log("Criterion: no chrome / document / window / localStorage / navigator");
console.log("core:", core.length, "files,", lines(core), "lines");
console.log("host shell:", host.size, "files,", lines([...host]), "lines\n");
console.log("host shell (* = touches a host global itself, rest are propagated):");
for (const f of [...host].sort()) {
  console.log("   " + (direct.has(f) ? "*" : " "), f);
}

// Once core/ exists this is the gate: nothing under it may reach a host global,
// directly or through an import. Until then it reports only.
if (strict) {
  const leaked = [...host].filter((f) => f.startsWith("core/"));
  if (leaked.length) {
    console.error("\ncore/ must stay host-agnostic, but these reach a host global:");
    for (const f of leaked) console.error("   " + f);
    process.exit(1);
  }
  console.log("\nBoundary intact.");
}
