#!/usr/bin/env node
/**
 * Renders the extension icon set from the single SVG source.
 *
 * Store manifests need fixed PNG sizes because some browsers ignore SVG
 * icons. The SVGs are rasterized at a higher density and downsampled so the
 * 16px variant stays crisp. Generated files are committed so a clean checkout
 * can build without running this script; rerun it after editing the SVG.
 */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "apps/extension/assets/icon.svg");
const OUTPUT_DIR = resolve(ROOT, "apps/extension/public/icon");
const ICON_SIZES = [16, 32, 48, 128];

const svg = await readFile(SOURCE);

await mkdir(OUTPUT_DIR, { recursive: true });

for (const size of ICON_SIZES) {
  const output = resolve(OUTPUT_DIR, `icon-${size}.png`);
  await sharp(svg, { density: 512 })
    .resize(size, size, { fit: "contain" })
    .png()
    .toFile(output);
  console.log(`icon: ${output} (${size}x${size})`);
}

console.log(`Generated ${ICON_SIZES.length} icons from ${SOURCE}`);
