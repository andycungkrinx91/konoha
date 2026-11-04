'use strict';

/**
 * Decides whether a dispatched subagent prompt should advertise the Konoha MCP
 * catalog.
 *
 * Advertising tools a client cannot call costs the full catalog on every turn
 * of that task and invites hallucinated `mcp__konoha__*` calls. Omitting them
 * where the server is genuinely attached costs capability. So attachment is
 * resolved from evidence, and absence must be positively proven before the
 * block is dropped:
 *
 *   - an explicit `mcpAttached` boolean from the launch path wins (handshake);
 *   - otherwise the client's own registration status is read;
 *   - if status is unavailable, unreadable, or does not report registration
 *     fields at all, the block is kept (unknown is not absence).
 */

const REGISTRATION_FIELDS = ['mcpKonoha', 'mcpSkillsDb', 'configured'];

let _statusResolver = null;

function defaultStatusResolver(client) {
  if (!_statusResolver) {
    _statusResolver = require('../agent_manager').getClientStatus;
  }
  return _statusResolver(client);
}

function readRegistration(status) {
  if (!status || typeof status !== 'object') return null;
  const fields = REGISTRATION_FIELDS.filter((field) => typeof status[field] === 'boolean');
  if (fields.length === 0) return null;
  return { registered: fields.some((field) => status[field] === true), fields };
}

function resolveSubagentToolPolicy({ client = null, mcpAttached, statusResolver = defaultStatusResolver } = {}) {
  const normalizedClient = client ? String(client).toLowerCase() : null;
  if (typeof mcpAttached === 'boolean') {
    return {
      client: normalizedClient,
      attached: mcpAttached,
      source: 'dispatch_handshake',
      detail: mcpAttached ? 'launch path reports the server attached' : 'launch path reports no server attached'
    };
  }
  if (!normalizedClient) {
    return { client: null, attached: true, source: 'unverified', detail: 'no active client reported' };
  }
  let status;
  try {
    status = statusResolver(normalizedClient);
  } catch (err) {
    return { client: normalizedClient, attached: true, source: 'status_error', detail: err && err.message ? err.message : 'status lookup failed' };
  }
  const registration = readRegistration(status);
  if (!registration) {
    return { client: normalizedClient, attached: true, source: 'unverified', detail: 'status does not report MCP registration' };
  }
  return {
    client: normalizedClient,
    attached: registration.registered,
    source: 'client_config',
    detail: registration.registered
      ? `konoha server registered (${registration.fields.join(', ')})`
      : `konoha server not registered (${registration.fields.join(', ')})`
  };
}

function buildNotAttachedNote(client) {
  const who = client ? `the ${client} client` : 'this client';
  return (
    '\n## MCP Tools\n' +
    `No Konoha MCP server is registered for ${who}, so no \`mcp__konoha__*\`, \`mcp__semble__*\`, or \`mcp__aislop__*\` tool exists in this session. ` +
    'Do not call them. Complete the task with the client\'s own file, search, and shell tools, and keep edits bounded.\n'
  );
}

module.exports = {
  REGISTRATION_FIELDS,
  resolveSubagentToolPolicy,
  buildNotAttachedNote
};
