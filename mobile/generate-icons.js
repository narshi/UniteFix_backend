const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const resDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
const iconPath = path.join(__dirname, 'assets', 'icon.png');

async function generateIcons() {
  if (!fs.existsSync(iconPath)) {
    console.error('Source icon not found at', iconPath);
    process.exit(1);
  }

  // Trim the padding and flatten onto the blue background color (#153980)
  // so the blue extends all the way to the edges, filling the square perfectly.
  const processedIconBuffer = await sharp(iconPath)
    .trim()
    .flatten({ background: { r: 21, g: 57, b: 128, alpha: 1 } })
    .toBuffer();

  for (const [density, size] of Object.entries(sizes)) {
    const dir = path.join(resDir, `mipmap-${density}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Generate square icon (ic_launcher.png)
    await sharp(processedIconBuffer)
      .resize(size, size)
      .toFile(path.join(dir, 'ic_launcher.png'));

    // Generate round icon (ic_launcher_round.png)
    const circleSvg = `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`;
    const circleMask = Buffer.from(circleSvg);

    await sharp(processedIconBuffer)
      .resize(size, size)
      .composite([{ input: circleMask, blend: 'dest-in' }])
      .toFile(path.join(dir, 'ic_launcher_round.png'));

    console.log(`Generated perfect borderless icons for ${density} (${size}x${size})`);
  }
}

generateIcons().catch(console.error);
