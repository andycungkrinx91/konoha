'use strict';

/**
 * Headless environment shim for Three.js GLTFExporter in Node.js environments.
 * Implements FileReader with onloadend support and binds self to globalThis.
 */

let _shimInstalled = false;

class HeadlessFileReader {
  constructor() {
    this.result = null;
    this.onload = null;
    this.onloadend = null;
    this.onerror = null;
  }

  _fire() {
    if (typeof this.onload === 'function') {
      try { this.onload({ target: this }); } catch (_) { /* ignore callback errors */ }
    }
    if (typeof this.onloadend === 'function') {
      try { this.onloadend({ target: this }); } catch (_) { /* ignore callback errors */ }
    }
  }

  _handleError(err) {
    if (typeof this.onerror === 'function') this.onerror(err);
  }

  readAsArrayBuffer(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      this._handleError(new Error('Invalid blob passed to readAsArrayBuffer'));
      return;
    }
    blob.arrayBuffer()
      .then(buf => {
        this.result = buf;
        this._fire();
      })
      .catch(err => this._handleError(err));
  }

  readAsDataURL(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      this._handleError(new Error('Invalid blob passed to readAsDataURL'));
      return;
    }
    blob.arrayBuffer()
      .then(buf => {
        const mime = blob.type || 'application/octet-stream';
        this.result = `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
        this._fire();
      })
      .catch(err => this._handleError(err));
  }

  readAsText(blob) {
    if (!blob || typeof blob.text !== 'function') {
      this._handleError(new Error('Invalid blob passed to readAsText'));
      return;
    }
    blob.text()
      .then(txt => {
        this.result = txt;
        this._fire();
      })
      .catch(err => this._handleError(err));
  }
}

function ensureHeadlessShim() {
  if (_shimInstalled) return;

  if (typeof globalThis.self === 'undefined') {
    globalThis.self = globalThis;
  }

  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  }

  if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = HeadlessFileReader;
  }

  _shimInstalled = true;
}

module.exports = {
  ensureHeadlessShim
};
