#!/usr/bin/env node
/**
 * Enforce the rule that keeps one repo from becoming one deployable.
 *
 * Every service must be shippable to its own server without the others. That
 * holds only while these boundaries hold, and a boundary that is documented but
 * unchecked is a boundary that erodes — usually via one "temporary" import that
 * nobody notices until a deploy fails.
 *
 * Checked here rather than by convention:
 *
 *   1. No app imports another app. apps/admin must never reach into apps/api,
 *      even for a type. Types travel through packages/shared-types.
 *
 *   2. No app or package escapes the workspace with `../..`. That is how a
 *      service acquires a dependency on the repo layout, which does not exist
 *      inside its container.
 *
 *   3. Browser-shipped code never imports a server-only package. Pulling
 *      @devsfleet/db into apps/admin or apps/pos would bundle the Postgres
 *      driver — and the connection string — into something a customer can view.
 *
 *   4. Every app declares the workspace packages it imports. pnpm's isolated
 *      node_modules means an undeclared import resolves locally and then fails
 *      in a production install.
 *
 *   Run: pnpm check:boundaries   (also runs in CI before any deploy)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const APPS = ["api", "admin", "pos"];
/** Packages that must never reach a browser or an Electron renderer. */
const SERVER_ONLY = ["@devsfleet/db"];
/** Code that ships to a client. */
const CLIENT_SURFACES = [
  { app: "admin", dirs: ["src"] },
  { app: "pos", dirs: ["src"] },
];

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs)$/;
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  "dist-electron",
  ".next",
  ".turbo",
  "release",
  "coverage",
]);

const violations = [];

function walk(dir, onFile) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, onFile);
    else if (SOURCE_EXT.test(entry)) onFile(full);
  }
}

/** Import specifiers, ignoring anything inside a comment or a string literal. */
function importsOf(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const specifiers = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /^\s*import\s+["']([^"']+)["']/gm,
  ];
  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

const report = (file, message) =>
  violations.push(`${relative(ROOT, file)}\n    ${message}`);

// -----------------------------------------------------------------------------
// 1 + 2 + 3: import rules across every app
// -----------------------------------------------------------------------------
for (const app of APPS) {
  const appDir = join(ROOT, "apps", app);
  const otherApps = APPS.filter((a) => a !== app);

  walk(appDir, (file) => {
    const source = readFileSync(file, "utf8");
    const isClientSurface = CLIENT_SURFACES.some(
      (s) => s.app === app && s.dirs.some((d) => file.startsWith(join(appDir, d))),
    );

    for (const specifier of importsOf(source)) {
      // 1. cross-app imports, by package name or by relative path
      for (const other of otherApps) {
        if (
          specifier === `@devsfleet/${other}` ||
          specifier.startsWith(`@devsfleet/${other}/`) ||
          new RegExp(`(^|/)\\.\\./+apps/${other}/`).test(specifier) ||
          specifier.includes(`/apps/${other}/`)
        ) {
          report(
            file,
            `imports apps/${other} ("${specifier}"). Services must not depend ` +
              `on each other — share through packages/shared-types instead.`,
          );
        }
      }

      // 2. escaping the workspace
      if (specifier.startsWith("../")) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(appDir)) {
          report(
            file,
            `reaches outside its workspace ("${specifier}"). That path does ` +
              `not exist inside this service's container.`,
          );
        }
      }

      // 3. server-only packages in client code
      if (isClientSurface && SERVER_ONLY.some((p) => specifier === p || specifier.startsWith(`${p}/`))) {
        report(
          file,
          `imports the server-only package "${specifier}" from client code. ` +
            `This would bundle the database driver, and the connection string, ` +
            `into something a user can read.`,
        );
      }
    }
  });
}

// -----------------------------------------------------------------------------
// 4: every imported workspace package is declared
// -----------------------------------------------------------------------------
for (const app of APPS) {
  const appDir = join(ROOT, "apps", app);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
  } catch {
    continue;
  }

  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);

  const used = new Set();
  walk(appDir, (file) => {
    for (const specifier of importsOf(readFileSync(file, "utf8"))) {
      if (specifier.startsWith("@devsfleet/")) {
        used.add(specifier.split("/").slice(0, 2).join("/"));
      }
    }
  });

  for (const pkg of used) {
    if (!declared.has(pkg)) {
      violations.push(
        `apps/${app}/package.json\n    imports ${pkg} but does not declare it. ` +
          `pnpm's isolated node_modules will resolve it here and fail in a ` +
          `production install.`,
      );
    }
  }
}

// -----------------------------------------------------------------------------

if (violations.length > 0) {
  console.error(`\n✗ ${violations.length} boundary violation(s):\n`);
  for (const v of violations) console.error(`  ${v}\n`);
  console.error(
    "These rules are what let each service deploy to its own server.\n" +
      "See docs/DEPLOYMENT.md.\n",
  );
  process.exit(1);
}

console.log("✓ service boundaries intact — each app is independently deployable");
