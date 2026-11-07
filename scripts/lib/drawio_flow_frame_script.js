'use strict';

/**
 * Browser-side frame hook for the drawio projection: label fit on load, then one
 * `updateFrame(i, total)` per capture. Kept as a string so `pageHtml` can inline it.
 */

const FRAME_SCRIPT = `
  window.fitLabels = function () {
    document.querySelectorAll('foreignObject > div').forEach(function (div) {
      var size = parseFloat(getComputedStyle(div).fontSize);
      var guard = 0;
      // Width-only: each card line is already shortened to its own width budget, and scale
      // bands add no italic/letter-spacing, so this only catches genuine overrun. Height is
      // never a signal here because Chromium reports a sub-pixel scrollHeight on a fitted line.
      while (guard < 26 && size > 12.5 && div.clientWidth > 0 && div.scrollWidth > div.clientWidth + 1) {
        size -= 0.5;
        div.style.fontSize = size + 'px';
        guard += 1;
      }
      // Still too wide at the floor: trim the copy so the type keeps its declared
      // size instead of shrinking below it.
      if (div.clientWidth > 0 && div.scrollWidth > div.clientWidth + 1) {
        var raw = div.textContent;
        while (raw.length > 3 && div.scrollWidth > div.clientWidth + 1) {
          raw = raw.slice(0, -2) + '\u2026';
          div.textContent = raw;
        }
      }
    });
  };
  document.addEventListener('DOMContentLoaded', function () {
    window.fitLabels();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { window.fitLabels(); });
  });
  function pulseLength(el) {
    if (el.dataset.len) return Number(el.dataset.len);
    var len = 600;
    try { len = Math.max(60, el.getTotalLength()); } catch (err) { len = 600; }
    el.dataset.len = String(len);
    el.style.strokeDasharray = '14 ' + (len + 24);
    return len;
  }
  window.updateFrame = function (frameIdx, total) {
    const progress = frameIdx / total;
    document.querySelectorAll('.flow-path').forEach(function (el) {
      el.style.strokeDashoffset = String(-progress * 14);
    });
    document.querySelectorAll('.pulse').forEach(function (el) {
      const len = pulseLength(el);
      if (!(len > 0)) return;
      const travel = (progress + Number(el.dataset.phase || 0)) % 1;
      el.style.strokeDashoffset = String(-travel * (len + 14));
      el.style.opacity = String(0.12 + 0.5 * Math.sin(Math.PI * travel));
    });
  };
`;

module.exports = FRAME_SCRIPT;
