const chalk = require('chalk');
const gradient = require('gradient-string');
const figlet = require('figlet');

const delay = ms => new Promise(res => setTimeout(res, ms));

async function runSplashScreen() {
  if (process.env.NO_ANIMATE === '1' || process.argv.includes('--no-animate') || process.env.CI === 'true') {
    return;
  }

  console.clear();
  process.stdout.write('\x1b[?25l'); // hide cursor

  const konohaText = figlet.textSync('KONOHA', { font: 'Slant' });
  const lines = konohaText.split('\n');

  // Chidori lightning rendering logic
  const width = 80;
  const height = 24;
  
  const chidoriColors = [
    chalk.hex('#64B4FF'),    // Electric Blue
    chalk.hex('#00FFFF'),    // Cyan
    chalk.hex('#B4DCFF'),    // Ice White-Blue
    chalk.hex('#FFFFFF'),    // Flash White
    chalk.hex('#00C8FF'),    // Deep Electric
    chalk.cyanBright,
    chalk.blueBright,
    chalk.whiteBright,
  ];
  const lightningChars = ['Z', '⌁', '⚡', '↯', 'ϟ', '═'];

  // Enhanced: Faster frames for smoother but much quicker animation
  const frames = 15;
  const textRevealStart = 5;  // Frame when text starts appearing
  
  for (let frame = 0; frame < frames; frame++) {
    const grid = new Array(height).fill(null).map(() => new Array(width).fill(' '));
    const colorGrid = new Array(height).fill(null).map(() => new Array(width).fill(null));

    // Flash effect: occasionally make the center completely white or cyan
    const isFlashFrame = Math.random() > 0.85;
    
    // Final flash frames (last 3) — full screen white flash fading out
    const isFinalFlash = frame >= frames - 3;

    // Generate lightning bursts
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);

    // Intensity builds up over time, peaks around 60-80%
    const progress = frame / frames;
    const intensity = isFinalFlash 
      ? (frames - frame) / 3  // Fade out
      : Math.min(1.0, progress * 1.8);

    const numBolts = Math.floor((15 + Math.floor(Math.random() * 15)) * intensity);
    for (let b = 0; b < numBolts; b++) {
      let x = centerX;
      let y = centerY;
      const angle = Math.random() * Math.PI * 2;
      const length = Math.floor((10 + Math.floor(Math.random() * 25)) * intensity);
      
      for (let l = 0; l < length; l++) {
        x += Math.cos(angle) * 3 + (Math.random() * 4 - 2);
        y += Math.sin(angle) * 1.5 + (Math.random() * 2 - 1);
        
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        
        if (ix >= 0 && ix < width && iy >= 0 && iy < height) {
          // More energy chars near center
          const distFromCenter = Math.sqrt((ix - centerX) ** 2 + (iy - centerY) ** 2);
          const isEnergy = distFromCenter < 10 ? Math.random() > 0.5 : Math.random() > 0.8;
          grid[iy][ix] = isEnergy ? '⚡' : lightningChars[Math.floor(Math.random() * lightningChars.length)];
          
          // Brighter colors near center (more white/cyan)
          if (isFinalFlash) {
            colorGrid[iy][ix] = chalk.whiteBright;
          } else if (distFromCenter < 8) {
            colorGrid[iy][ix] = isFlashFrame ? chalk.whiteBright : (Math.random() > 0.3 ? chalk.hex('#FFFFFF') : chalk.hex('#00FFFF'));
          } else {
            colorGrid[iy][ix] = isFlashFrame ? chalk.whiteBright : chidoriColors[Math.floor(Math.random() * chidoriColors.length)];
          }
        }
        
        // occasional forks / static with more density
        if (Math.random() > 0.4) {
          const sx = ix + Math.floor(Math.random() * 9) - 4;
          const sy = iy + Math.floor(Math.random() * 5) - 2;
          if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
            grid[sy][sx] = Math.random() > 0.4 ? '⚡' : (Math.random() > 0.5 ? '⌁' : 'ϟ');
            colorGrid[sy][sx] = isFlashFrame ? chalk.cyanBright : chidoriColors[Math.floor(Math.random() * chidoriColors.length)];
          }
        }
      }
    }

    // Shockwave rings expanding from center every 8 frames
    if (frame > 5 && frame % 8 < 3) {
      const ringRadius = ((frame % 8) + 1) * 6 + Math.floor(frame / 8) * 3;
      for (let angle = 0; angle < Math.PI * 2; angle += 0.15) {
        const rx = Math.floor(centerX + Math.cos(angle) * ringRadius);
        const ry = Math.floor(centerY + Math.sin(angle) * (ringRadius * 0.5));
        if (rx >= 0 && rx < width && ry >= 0 && ry < height) {
          const ringChar = frame % 8 === 0 ? '═' : (frame % 8 === 1 ? '⌁' : '⚡');
          grid[ry][rx] = ringChar;
          colorGrid[ry][rx] = chalk.hex('#00C8FF');
        }
      }
    }

    process.stdout.write('\x1b[H');
    const outputLines = [];
    
    const startY = Math.floor(height / 2) - Math.floor(lines.length / 2);
    
    for (let y = 0; y < height; y++) {
      const isTextLine = y >= startY && y < startY + lines.length;
      const textLine = isTextLine ? lines[y - startY] : '';
      
      let lineStr = '';
      
      if (isTextLine && textLine.trim() !== '') {
        const startX = Math.floor(width / 2) - Math.floor(textLine.length / 2);
        
        // Text reveal: characters appear from center outward
        let revealedText = '';
        if (frame >= textRevealStart) {
          const revealProgress = Math.min(1.0, (frame - textRevealStart) / 15);
          const halfLen = Math.floor(textLine.length / 2);
          const revealChars = Math.floor(halfLen * revealProgress);
          
          for (let ci = 0; ci < textLine.length; ci++) {
            const distFromMid = Math.abs(ci - halfLen);
            if (distFromMid <= revealChars) {
              revealedText += textLine[ci];
            } else {
              revealedText += ' ';
            }
          }
        } else {
          revealedText = ' '.repeat(textLine.length);
        }
        
        // Before text
        for (let x = 0; x < startX; x++) {
          const char = grid[y][x];
          const color = colorGrid[y][x];
          lineStr += (color && char !== ' ') ? color(char) : char;
        }
        
        // Text overlay with chidori gradient
        const gradFunc = gradient.default || gradient;
        const chidoriGrad = gradFunc(['#64B4FF', '#00FFFF', '#B4DCFF', '#FFFFFF', '#00C8FF']);
        lineStr += chidoriGrad(revealedText);
        
        // After text
        for (let x = startX + textLine.length; x < width; x++) {
          const char = grid[y][x];
          const color = colorGrid[y][x];
          lineStr += (color && char !== ' ') ? color(char) : char;
        }
      } else {
        // Full line background
        for (let x = 0; x < width; x++) {
          const char = grid[y][x];
          const color = colorGrid[y][x];
          lineStr += (color && char !== ' ') ? color(char) : char;
        }
      }
      
      outputLines.push(lineStr);
    }
    console.log(outputLines.join('\n'));

    await delay(25);
  }

  process.stdout.write('\x1b[?25h'); // show cursor
  console.clear();
}

module.exports = { runSplashScreen };
