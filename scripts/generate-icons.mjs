import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'icons', 'icon-master.svg');
const outPath = resolve(root, 'icons', 'icon.png');

const svg = readFileSync(svgPath);

await sharp(svg)
  .resize(1024, 1024)
  .png()
  .toFile(outPath);

console.log('Generated icons/icon.png (1024x1024)');
