'use strict';

/**
 * bin/commands/config.js — Canonical global Konoha configuration manager.
 * Implements: list, get, set, unset over ~/.konoha/config.json with key allowlist,
 * atomic file writes, and structured JSON output.
 */

const fs = require('fs');
const path = require('path');
const { KONOHA } = require('../lib/paths');
const { C, log, error, success } = require('../lib/format');
const backupManager = require('../../src/config_backup_manager');

const CONFIG_FILE = path.join(KONOHA, 'config.json');

const ALLOWED_KEYS = new Set([
  'turn_budget',
  'token_budget',
  'hitl_mode',
  'auto_signoff',
  'log_level',
  'active_client',
  'searxng_url',
  'telegram_token',
  'telegram_chat_id',
  'default_agent',
  'theme',
]);

function _validateKey(key, usageHint) {
  if (!key) {
    error(`Usage: ${usageHint}`);
    process.exitCode = 1;
    return false;
  }
  if (!ALLOWED_KEYS.has(key)) {
    error(`Unknown configuration key "${key}". Allowed keys: ${Array.from(ALLOWED_KEYS).join(', ')}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function readConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function writeConfigFileAtomic(configObj) {
  fs.mkdirSync(KONOHA, { recursive: true });
  const tmpFile = path.join(KONOHA, `config.json.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmpFile, JSON.stringify(configObj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpFile, CONFIG_FILE);
}

function parseValue(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null') return null;
  const num = Number(val);
  if (!isNaN(num) && val.trim() !== '') return num;
  return val;
}

function _parseFlagValue(args, prefix, defaultValue) {
  const match = args.find((a) => a.startsWith(`${prefix}=`));
  if (match) return match.slice(prefix.length + 1).trim();
  const idx = args.indexOf(prefix);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    return args[idx + 1].trim();
  }
  return defaultValue;
}

function _parseBackupRestoreOptions(args) {
  const client = _parseFlagValue(args, '--client', 'all');
  const scope = _parseFlagValue(args, '--scope', 'all');
  const fromPath = _parseFlagValue(args, '--from', null);
  const toPath = _parseFlagValue(args, '--to', null);
  const projectRoot = _parseFlagValue(args, '--project', process.cwd());
  return { client, scope, fromPath, toPath, projectRoot };
}

function _handleBackupSubcommand(args, jsonOut) {
  const opts = _parseBackupRestoreOptions(args);
  const res = backupManager.backupClientConfigs(opts.client, {
    scope: opts.scope,
    projectRoot: opts.projectRoot
  });
  if (jsonOut) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  } else {
    success(`Backed up ${res.backedUpCount} configuration file(s) for client=${opts.client} (scope=${opts.scope}).`);
  }
  return res;
}

function _handleBackupsListSubcommand(args, jsonOut) {
  const opts = _parseBackupRestoreOptions(args);
  const entries = backupManager.listClientBackups({
    client: opts.client,
    scope: opts.scope,
    projectRoot: opts.projectRoot
  });
  if (jsonOut) {
    process.stdout.write(JSON.stringify({ backups: entries }, null, 2) + '\n');
    return entries;
  }
  log(`  ${C.bold}Konoha Configuration Backups (client=${opts.client}, scope=${opts.scope}):${C.reset}`);
  if (entries.length === 0) {
    log(`  ${C.dim}(no tracked configuration backups found)${C.reset}`);
  } else {
    for (const item of entries) {
      log(`    [${item.client}:${item.scope}] ${item.sourcePath} -> ${item.latestBackup || '(created by konoha)'}`);
    }
  }
  return entries;
}

function _handleRestoreSubcommand(args, jsonOut) {
  const opts = _parseBackupRestoreOptions(args);
  if (opts.fromPath && opts.toPath) {
    const snapRes = backupManager.restoreFromBackupSnapshot(opts.fromPath, opts.toPath);
    if (!snapRes.ok) {
      error(snapRes.error || 'Backup restore failed');
      process.exitCode = 1;
      return snapRes;
    }
    if (jsonOut) {
      process.stdout.write(JSON.stringify(snapRes, null, 2) + '\n');
    } else {
      success(`Restored ${opts.toPath} from snapshot ${opts.fromPath}.`);
    }
    return snapRes;
  }
  const res = backupManager.restoreLatestClientBackups({
    client: opts.client,
    scope: opts.scope,
    projectRoot: opts.projectRoot
  });
  if (jsonOut) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  } else {
    success(`Restored ${res.restoredCount} configuration file(s) (removed ${res.removedCreatedCount} Konoha-created file(s)) for client=${opts.client}.`);
  }
  return res;
}

function cmdConfigHelp() {
  log(`
${C.cyan}konoha config${C.reset} — Manage global Konoha system configuration & client config backups

${C.bold}USAGE${C.reset}
  konoha config <subcommand> [key] [value] [--json]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}list${C.reset}                 List all configured key-value pairs
  ${C.cyan}get <key>${C.reset}            Get the value of a specific configuration key
  ${C.cyan}set <key> <val>${C.reset}      Set the value of a configuration key
  ${C.cyan}unset <key>${C.reset}          Remove a configuration key
  ${C.cyan}backup${C.reset}               Back up AI client configurations (--client=<name|all> --scope=<global|project|all>)
  ${C.cyan}backups${C.reset}              List available AI client configuration backups
  ${C.cyan}restore${C.reset}              Restore AI client configurations from verified backups (--client=<name|all> --scope=<global|project|all>)

${C.bold}ALLOWED KEYS${C.reset}
  ${Array.from(ALLOWED_KEYS).join(', ')}

${C.bold}EXAMPLES${C.reset}
  konoha config list
  konoha config set turn_budget 16384
  konoha config backup --client=cursor --scope=all
  konoha config restore --client=cursor --scope=all
`);
}

async function cmdConfig(cmdArgs = []) {
  const args = Array.isArray(cmdArgs) ? [...cmdArgs] : [];
  if (args.includes('--help') || args.includes('-h')) {
    cmdConfigHelp();
    return;
  }

  const jsonOut = args.includes('--json');
  const cleanArgs = args.filter((a) => a !== '--json');
  const subcommand = cleanArgs[0] || 'list';
  const key = cleanArgs[1];
  const value = cleanArgs[2];

  const config = readConfigFile();

  switch (subcommand) {
    case 'list': {
      if (jsonOut) {
        process.stdout.write(JSON.stringify({ config }, null, 2) + '\n');
        return config;
      }
      log(`  ${C.bold}Konoha Global Configuration (${CONFIG_FILE}):${C.reset}`);
      const entries = Object.entries(config);
      if (entries.length === 0) {
        log(`  ${C.dim}(no configuration keys set)${C.reset}`);
      } else {
        for (const [k, v] of entries) {
          log(`    ${C.cyan}${k}${C.reset}: ${JSON.stringify(v)}`);
        }
      }
      return config;
    }

    case 'get': {
      if (!_validateKey(key, 'konoha config get <key>')) {
        return null;
      }
      const val = config[key];
      if (jsonOut) {
        process.stdout.write(JSON.stringify({ key, value: val !== undefined ? val : null }, null, 2) + '\n');
      } else if (val !== undefined) {
        log(String(val));
      } else {
        log(`  ${C.dim}(unset)${C.reset}`);
      }
      return val;
    }

    case 'set': {
      if (!key || value === undefined) {
        error('Usage: konoha config set <key> <value>');
        process.exitCode = 1;
        return null;
      }
      if (!ALLOWED_KEYS.has(key)) {
        error(`Disallowed configuration key "${key}". Allowed keys: ${Array.from(ALLOWED_KEYS).join(', ')}`);
        process.exitCode = 1;
        return null;
      }
      const parsed = parseValue(value);
      config[key] = parsed;
      writeConfigFileAtomic(config);
      if (jsonOut) {
        process.stdout.write(JSON.stringify({ status: 'ok', key, value: parsed }, null, 2) + '\n');
      } else {
        success(`Configuration updated: ${key} = ${JSON.stringify(parsed)}`);
      }
      return { key, value: parsed };
    }

    case 'unset': {
      if (!_validateKey(key, 'konoha config unset <key>')) {
        return null;
      }
      delete config[key];
      writeConfigFileAtomic(config);
      if (jsonOut) {
        process.stdout.write(JSON.stringify({ status: 'ok', unset: key }, null, 2) + '\n');
      } else {
        success(`Configuration key unset: ${key}`);
      }
      return { unset: key };
    }

    case 'backup':
      return _handleBackupSubcommand(cleanArgs.slice(1), jsonOut);

    case 'backups':
      return _handleBackupsListSubcommand(cleanArgs.slice(1), jsonOut);

    case 'restore':
      return _handleRestoreSubcommand(cleanArgs.slice(1), jsonOut);

    default: {
      error(`Unknown config subcommand "${subcommand}". Use "list", "get", "set", "unset", "backup", "backups", or "restore".`);
      process.exitCode = 1;
      return null;
    }
  }
}

module.exports = {
  cmdConfig,
  cmdConfigHelp,
  readConfigFile,
  writeConfigFileAtomic,
  ALLOWED_KEYS,
  CONFIG_FILE,
};
