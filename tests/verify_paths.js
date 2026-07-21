const p = require('../bin/lib/paths');
const keys = Object.keys(p).sort();
console.log('exports:', keys.length, 'keys');
keys.forEach(k => console.log(' ', k, ':', typeof p[k] === 'function' ? '(fn)' : p[k]));
