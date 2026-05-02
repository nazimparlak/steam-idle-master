import fs from 'node:fs';
import path from 'node:path';
import svgToIco from 'svg-to-ico';
import sharp from 'sharp';

const root = path.resolve(process.cwd());
const buildDir = path.join(root, 'build');
const svgPath = path.join(buildDir, 'icon.svg');

if (!fs.existsSync(svgPath)) {
  console.error(`Missing ${svgPath}`);
  process.exit(1);
}

fs.mkdirSync(buildDir, { recursive: true });

const icoPath = path.join(buildDir, 'icon.ico');
const pngPath = path.join(buildDir, 'icon.png');

// Produce a good multi-size .ico for Windows, and a 512px png for electron-builder generic icon.
await svgToIco({
  input_name: svgPath,
  output_name: icoPath,
  sizes: [16, 24, 32, 48, 64, 128, 256],
  compression_level: 9,
});

await sharp(svgPath)
  .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(pngPath);

console.log(`✅ Wrote ${path.relative(root, icoPath)} and ${path.relative(root, pngPath)}`);

