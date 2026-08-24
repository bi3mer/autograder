/**
 * Assemble `_site/`: the files GitHub Pages serves, and nothing else.
 *
 * The Pages action uploads a directory as-is, so pointing it at the checkout
 * would ship `node_modules/`, `src/`, and the tests to the public site. This
 * copies the four directories a visitor actually loads, after `npm run build`
 * and `npm run docs` have produced two of them.
 *
 * Run with `npm run site`.
 */

import { access, cp, rm, mkdir } from "node:fs/promises";

/** Directories copied into `_site/`, in the order a visitor meets them. */
const DIRECTORIES = ["cs230", "css", "dist", "docs"];

/** Files copied to the site root. `index.html` is what `/` serves. */
const FILES = ["index.html"];

/**
 * Copy one path into `_site/`, failing with a usable message when it is absent.
 *
 * @param {string} path Repository-relative path to copy.
 * @returns {Promise<void>} Resolves once the copy lands.
 */
async function copy_into_site(path) {
  try {
    await access(path);
  } catch {
    throw new Error(`missing ${path}: run 'npm run build' and 'npm run docs' first`);
  }
  await cp(path, `_site/${path}`, { recursive: true });
  console.log(`  copied ${path}`);
}

await rm("_site", { recursive: true, force: true });
await mkdir("_site", { recursive: true });

for (const directory of DIRECTORIES) await copy_into_site(directory);
for (const file of FILES) await copy_into_site(file);

console.log("assembled _site");
