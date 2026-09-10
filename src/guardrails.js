'use strict';

/**
 * Konoha shared command guardrails (single source of truth).
 *
 * Enforces the konoha runtime contract's destructive-command, git-safety and
 * secret-protection rules at the tool-call level for every client that
 * supports blocking hooks (Pi, Claude Code, Command Code, Antigravity).
 * Clients without hooks (Codex, Cursor, OpenCode) keep the prompt-only rules.
 *
 * The checker below is deliberately SELF-CONTAINED: it must not reference any
 * identifier from this module's scope (only standard built-ins such as
 * RegExp, String and Array). This is what lets managers inline
 * `buildGuardrailCheckerSource()` verbatim into generated payloads
 * (Pi TS extension, Claude Code / Command Code blocker scripts) while the
 * local Node copy stays byte-identical to the embedded copies.
 */

/**
 * Checks a shell command string against the konoha guardrails.
 *
 * Two layers:
 *  1. Whole-command regex scans for destructive and destructive-git patterns
 *     (matched anywhere in the command, so `sudo` prefixes are covered).
 *  2. Segment/stage tokenization for read-bypass and secret protection:
 *     the command is split on `&&` / `||` / `;` into segments, each segment
 *     on `|` into pipe stages. Read-bypass applies only to the FIRST stage
 *     of a segment (filter position such as `ps aux | grep node` is allowed);
 *     secrets are checked in every stage whose effective binary is a reader
 *     (or `git add` / `git commit`). Leading `sudo` and `FOO=bar` env
 *     assignments are stripped when resolving the effective binary, and an
 *     `rtk` prefix exempts a stage from read-bypass only (never secrets).
 *
 * `rm` safety is tokenized (not regex): rm with recursive+force flags whose
 * target is `/`, `~`, `$HOME` (or their `/*` globs) is destructive.
 *
 * @param {string} command - raw shell command text.
 * @returns {{ category: string, reason: string } | null} violation or null.
 */
function checkCommandGuardrails(command) {
  if (typeof command !== 'string') return null;
  var cmd = command.trim();
  if (!cmd) return null;

  var REASON_DESTRUCTIVE =
    'DESTRUCTIVE COMMAND BLOCKED: this command matches a konoha destructive-command guardrail ' +
    '(rm -rf on root/home, mkfs, dd to a device, DROP DATABASE / TRUNCATE TABLE, chmod 777, ' +
    'recursive chown, or curl/wget piped into a shell). Ask the user for explicit permission ' +
    'before running it.';

  var REASON_DESTRUCTIVE_GIT =
    'DESTRUCTIVE GIT COMMAND BLOCKED: this command matches a konoha git-safety guardrail ' +
    '(git reset --hard, git push --force, git clean -f, git checkout -- ., git rebase -i). ' +
    'Ask the user for explicit permission before running it.';

  var REASON_SECRETS =
    'SECRET FILE ACCESS BLOCKED: reading or committing secret files (.env*, secrets.yaml, ' +
    '*.tfvars, *.pem, *.key, id_rsa, credentials) requires explicit user permission. ' +
    'Redact all secret values and never print, dump or commit them.';

  var REASON_READ_BYPASS =
    'KONOHA RULE VIOLATION: using shell read tools to inspect repository files is forbidden. ' +
    'Retry with "rtk <command>", or use the konoha MCP bounded file tools ' +
    '(read_file_head, read_file_range, file_info, get_file_structure, find_files_clean, ' +
    'token_efficient_grep) or the semble MCP (search / find_related) instead.';

  // ---- Layer 1: whole-command regex scans --------------------------------
  var wholeCommandPatterns = [
    { category: 'destructive', pattern: /\bmkfs(\.\w+)?\b/, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\bdd\b[^|;&]*\bof=\s*\/dev\//, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\b(DROP\s+DATABASE|TRUNCATE\s+TABLE)\b/i, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\bchmod\s+(-[A-Za-z]+\s+)*777\b/, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\bchown\b[^|;&]*(-R\b|--recursive\b)/, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/, reason: REASON_DESTRUCTIVE },
    { category: 'destructive-git', pattern: /\bgit\s+reset\b[^|;&]*--hard\b/, reason: REASON_DESTRUCTIVE_GIT },
    { category: 'destructive-git', pattern: /\bgit\s+push\b[^|;&]*\s--force(?![-\w])/, reason: REASON_DESTRUCTIVE_GIT },
    { category: 'destructive-git', pattern: /\bgit\s+clean\b[^|;&]*\s-[A-Za-z]*f/, reason: REASON_DESTRUCTIVE_GIT },
    { category: 'destructive-git', pattern: /\bgit\s+checkout\s+(-[A-Za-z]+\s+)*--\s+\./, reason: REASON_DESTRUCTIVE_GIT },
    { category: 'destructive-git', pattern: /\bgit\s+rebase\s+(-[A-Za-z]*\s+)*(-i\b|--interactive\b)/, reason: REASON_DESTRUCTIVE_GIT }
  ];

  for (var w = 0; w < wholeCommandPatterns.length; w++) {
    if (wholeCommandPatterns[w].pattern.test(cmd)) {
      return { category: wholeCommandPatterns[w].category, reason: wholeCommandPatterns[w].reason };
    }
  }

  // ---- Layer 2: segment / stage tokenization ------------------------------
  var READ_BYPASS_BINARIES = [
    'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'fd',
    'ag', 'ack', 'less', 'more', 'bat', 'wc', 'zcat'
  ];
  var SECRET_READERS = [
    'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'less', 'more',
    'bat', 'wc', 'strings', 'xxd', 'od', 'awk', 'sed', 'file', 'nl', 'zcat'
  ];

  function stripQuotes(token) {
    return token.replace(/^['"]/, '').replace(/['"]$/, '');
  }

  function isSecretPathToken(token) {
    var base = stripQuotes(token).replace(/^.*\//, '');
    if (/^\.env/.test(base)) return true;
    if (/^secrets\.(ya?ml|json)$/.test(base)) return true;
    if (/\.(tfvars|pem|key)$/.test(base)) return true;
    if (/^id_rsa/.test(base)) return true;
    if (/^credentials/.test(base)) return true;
    return false;
  }

  function parseStage(stage) {
    var tokens = stage.trim().split(/\s+/).filter(Boolean);
    var rtk = false;
    while (tokens.length) {
      var t = tokens[0];
      if (t === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { tokens.shift(); continue; }
      if (t === 'rtk' && !rtk) { rtk = true; tokens.shift(); continue; }
      break;
    }
    var bin = tokens.length ? stripQuotes(tokens[0]).replace(/^.*\//, '') : '';
    return { tokens: tokens, bin: bin, rtk: rtk };
  }

  function checkRm(tokens) {
    var flagChars = '';
    var hasRecursive = false;
    var hasForce = false;
    var targets = [];
    for (var i = 1; i < tokens.length; i++) {
      var t = stripQuotes(tokens[i]);
      if (t === '--recursive') { hasRecursive = true; continue; }
      if (t === '--force') { hasForce = true; continue; }
      if (/^-[A-Za-z]+$/.test(t)) { flagChars += t.slice(1); continue; }
      targets.push(t);
    }
    if (!(hasRecursive || /[rR]/.test(flagChars))) return null;
    if (!(hasForce || /f/.test(flagChars))) return null;
    for (var j = 0; j < targets.length; j++) {
      var tgt = targets[j].replace(/\/+$/, '');
      if (tgt === '' || tgt === '/' || tgt === '~' || tgt === '$HOME' ||
          tgt === '/*' || tgt === '~/*' || tgt === '$HOME/*') {
        return { category: 'destructive', reason: REASON_DESTRUCTIVE };
      }
    }
    return null;
  }

  var segments = cmd.split(/&&|\|\||;/);
  for (var s = 0; s < segments.length; s++) {
    if (!segments[s].trim()) continue;
    var stages = segments[s].split('|');
    for (var g = 0; g < stages.length; g++) {
      if (!stages[g].trim()) continue;
      var parsed = parseStage(stages[g]);
      if (!parsed.bin) continue;

      // Read-bypass: first stage of a pipe chain only, exempt when rtk-prefixed.
      // Secrets are checked first so the more specific violation wins when a
      // command is both a raw read and a secret access (e.g. `cat .env`).
      // rm -rf on root/home targets.
      if (parsed.bin === 'rm') {
        var rmViolation = checkRm(parsed.tokens);
        if (rmViolation) return rmViolation;
      }

      // Secrets: any reader stage, plus git add/commit.
      if (SECRET_READERS.indexOf(parsed.bin) !== -1) {
        for (var k = 1; k < parsed.tokens.length; k++) {
          if (isSecretPathToken(parsed.tokens[k])) {
            return { category: 'secrets', reason: REASON_SECRETS };
          }
        }
      } else if (parsed.bin === 'git' && parsed.tokens.length > 1 &&
                 (parsed.tokens[1] === 'add' || parsed.tokens[1] === 'commit')) {
        for (var m = 2; m < parsed.tokens.length; m++) {
          if (isSecretPathToken(parsed.tokens[m])) {
            return { category: 'secrets', reason: REASON_SECRETS };
          }
        }
      }

      if (g === 0 && !parsed.rtk && READ_BYPASS_BINARIES.indexOf(parsed.bin) !== -1) {
        return { category: 'read-bypass', reason: REASON_READ_BYPASS };
      }
    }
  }

  return null;
}

/**
 * Returns the checker function source for inlining into generated payloads.
 * Uses Function.prototype.toString() on the non-minified declaration so the
 * embedded copies are byte-identical to the local one (single source of truth).
 * @returns {string}
 */
function buildGuardrailCheckerSource() {
  return checkCommandGuardrails.toString();
}

module.exports = {
  checkCommandGuardrails,
  buildGuardrailCheckerSource
};
