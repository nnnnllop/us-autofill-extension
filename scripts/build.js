/**
 * Sync shared sources from src/ into chrome/ and firefox/ packages.
 * Manifests stay package-specific and are never overwritten.
 *
 * Usage: node scripts/build.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const TARGETS = ["chrome", "firefox"];

function rmDirContents(dir, { keep = [] } = {}) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (keep.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    fs.rmSync(full, { recursive: true, force: true });
  }
}

function copyRecursive(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      copyRecursive(path.join(from, name), path.join(to, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function assertSrc() {
  const required = ["background.js", "content.js", "content.css", "popup", "icons"];
  for (const name of required) {
    const p = path.join(SRC, name);
    if (!fs.existsSync(p)) {
      throw new Error(`Missing src/${name}`);
    }
  }
}

function build() {
  assertSrc();

  for (const target of TARGETS) {
    const dest = path.join(ROOT, target);
    const manifest = path.join(dest, "manifest.json");
    if (!fs.existsSync(manifest)) {
      throw new Error(`Missing ${target}/manifest.json — create it before building`);
    }

    // Wipe package files except browser-specific manifest
    rmDirContents(dest, { keep: ["manifest.json"] });

    // Copy shared sources
    for (const name of fs.readdirSync(SRC)) {
      copyRecursive(path.join(SRC, name), path.join(dest, name));
    }

    console.log(`✓ ${target}/  (manifest preserved)`);
  }

  console.log("Build done. Load chrome/ in Chromium, firefox/ in Firefox.");
}

build();
