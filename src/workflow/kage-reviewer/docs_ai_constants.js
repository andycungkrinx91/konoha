'use strict';

const AI_BUZZWORDS = [
  'leverage', 'leveraging', 'leveraged',
  'delve', 'delving', 'delves',
  'tapestry', 'testament', 'testament to',
  'seamless', 'seamlessly',
  'paramount', 'pivotal',
  'beacon', 'game-changer',
  'it is important to note', 'it is worth noting',
  'in conclusion', 'in summary',
  'furthermore', 'moreover',
  'realm', 'underscores', 'multifaceted', 'holistic',
  'foster', 'fosters', 'fostering',
  'dynamic landscape', 'ever-evolving',
  'embark', 'harness', 'harnessing',
  'unlock', 'unlocking', 'vital role',
  'crucial aspect', 'comprehensive suite',
  'it is crucial', 'it is essential', 'it is worth highlighting',
  'plays a pivotal role', 'plays a key role', 'plays a central role',
  'spearheaded by', 'serves as a reminder', 'in order to facilitate',
  'intricate balance', 'fast-paced world', 'indelible mark',
  'resonates deeply', 'a myriad of', 'in essence',
  'tidak dapat dipungkiri', 'tidak dapat disangkal',
  'merupakan hal yang sangat penting',
  'memainkan peran yang sangat penting',
  'memainkan peran krusial', 'berperan krusial',
  'memainkan peran sentral', 'patut dicatat bahwa', 'pada intinya',
  'merupakan wujud nyata', 'di era serba cepat ini', 'tak dapat dipisahkan',
  'menyelami', 'menelusuri jejak',
  'bukti nyata bahwa', 'tonggak sejarah yang tak lekang',
  'secara komprehensif', 'berbagai aspek yang melingkupi',
  'pada akhirnya dapat disimpulkan',
  'di era modern ini', 'di era globalisasi ini',
  'fondasi kokoh', 'menjadi saksi bisu',
  'tak lekang oleh waktu', 'sangatlah penting untuk dicatat',
  'tidak diragukan lagi bahwa'
];

const AI_COLLOCATIONS = [
  'without dropping a single',
  'throughout the cutover window',
  'eliminated single points of failure across our entire',
  'under continuous load',
  'strictly below',
  'serves as a testament to',
  'plays a pivotal role in ensuring',
  'fosters a culture of continuous',
  'comprehensive suite of',
  'fast-paced world of',
  'ever-evolving landscape of',
  'intricate balance between',
  'resonates deeply with',
  'vital role in facilitating'
];

const GENERATOR_SIGNATURES = [
  { pattern: /python-docx/i, name: 'python-docx' },
  { pattern: /docx-js/i, name: 'docx-js' },
  { pattern: /docx4j/i, name: 'docx4j' },
  { pattern: /reportlab/i, name: 'ReportLab PDF Library' },
  { pattern: /weasyprint/i, name: 'WeasyPrint' },
  { pattern: /wkhtmltopdf/i, name: 'wkhtmltopdf' },
  { pattern: /openpyxl/i, name: 'openpyxl' },
  { pattern: /xlsxwriter/i, name: 'xlsxwriter' },
  { pattern: /python-pptx/i, name: 'python-pptx' },
  { pattern: /pptxgenjs/i, name: 'pptxgenjs' },
  { pattern: /pdfkit/i, name: 'pdfkit' },
  { pattern: /puppeteer/i, name: 'puppeteer' }
];

const WATERMARK_PATTERNS = [
  /w:watermark/i,
  /PowerPlusWaterMarkObject/i,
  /id=["'][^"']*watermark[^"']*["']/i,
  /type=["']#_x0000_t136["']/i,
  /\/Type\s*\/Annot\s*\/Subtype\s*\/Watermark/i,
  /\/Watermark\b/i,
  /watermark-ribbon/i,
  /confidential-watermark/i
];

module.exports = {
  AI_BUZZWORDS,
  AI_COLLOCATIONS,
  GENERATOR_SIGNATURES,
  WATERMARK_PATTERNS
};
