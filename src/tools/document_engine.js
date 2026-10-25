'use strict';

const { documentCreate } = require('./doc_engine_docx_pdf');
const { spreadsheetCreate } = require('./doc_engine_spreadsheet');
const { presentationCreate } = require('./doc_engine_presentation');
const { diagramCreate } = require('./doc_engine_diagram');
const { animationExport, validateAnimatedWebP } = require('./doc_engine_animation');

module.exports = {
  documentCreate,
  spreadsheetCreate,
  presentationCreate,
  diagramCreate,
  animationExport,
  validateAnimatedWebP
};
