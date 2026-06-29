'use strict';

const { sendJson } = require('../utils');

async function handleProxy(ctx, req, res) {
  sendJson(res, 404, { error: { message: 'Sidecar RPC proxy disabled', type: 'not_found' } });
}

module.exports = { handleProxy };
