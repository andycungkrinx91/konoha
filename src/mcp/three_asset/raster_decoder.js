'use strict';

/**
 * Universal headless raster decoder for PNG, JPG, JPEG, and WebP images.
 * Uses native zlib PNG streaming for fast decoding and Playwright Chromium canvas for JPEG/WebP.
 */

const fs = require('fs');
const path = require('path');
const { parsePngPixels } = require('./image_relief');

async function decodeRasterToPixels(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const fileBuf = fs.readFileSync(filePath);

  if (ext === '.png') {
    const png = parsePngPixels(fileBuf);
    if (!png) throw new Error(`Raster decode failed for ${ext}: Invalid PNG chunk stream`);
    return { width: png.width, height: png.height, rgba: png.data };
  }

  let playwright;
  try {
    playwright = require('playwright');
  } catch (err) {
    throw new Error(`Raster decode failed for ${ext}: Playwright unavailable (${err.message})`);
  }

  let mime = 'image/jpeg';
  if (ext === '.webp') mime = 'image/webp';

  const b64 = fileBuf.toString('base64');
  let browser = null;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    const result = await page.evaluate(async ({ dataUrl, maxEdge }) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          let w = img.naturalWidth || img.width || 64;
          let h = img.naturalHeight || img.height || 64;
          if (w > maxEdge || h > maxEdge) {
            if (w >= h) {
              h = Math.round((h * maxEdge) / w);
              w = maxEdge;
            } else {
              w = Math.round((w * maxEdge) / h);
              h = maxEdge;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h);
          resolve({ width: w, height: h, data: Array.from(imgData.data) });
        };
        img.onerror = () => reject(new Error('Image element decoding failed'));
        img.src = dataUrl;
      });
    }, { dataUrl: `data:${mime};base64,${b64}`, maxEdge: 96 });

    return {
      width: result.width,
      height: result.height,
      rgba: Buffer.from(result.data)
    };
  } catch (err) {
    throw new Error(`Raster decode failed for ${ext}: ${err.message}`);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* intentional best-effort fallback: optional decoder path */ }
    }
  }
}

module.exports = {
  decodeRasterToPixels
};
