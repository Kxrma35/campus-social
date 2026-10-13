import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sharp = createRequire(join(root, "../api/package.json"))("sharp");

const jobs = [
  ["icon.svg", "icon.png", 1024],
  ["foreground.svg", "adaptive-foreground.png", 1024],
  ["splash.svg", "splash.png", 1024],
  ["icon.svg", "favicon.png", 48],
];
for (const [src, out, size] of jobs) {
  const svg = readFileSync(join(root, "assets/source", src));
  const png = await sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();
  writeFileSync(join(root, "assets", out), png);
  console.log(`${out} ${size}x${size} ${png.length}B`);
}
