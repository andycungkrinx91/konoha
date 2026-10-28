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
    '(rm -rf on root/home, mkfs, dd to a device, forkbomb, chmod 777, ' +
    'recursive chown, or curl/wget piped into a shell). Ask the user for explicit permission ' +
    'before running it.';

  var REASON_DESTRUCTIVE_SYS =
    'SYSTEM / SRE SHUTDOWN BLOCKED: system shutdown, reboot, poweroff, halt, or disk wipe ' +
    'is strictly forbidden without explicit user permission.';

  var REASON_DESTRUCTIVE_GIT =
    'DESTRUCTIVE GIT COMMAND BLOCKED: this command matches a konoha git-safety guardrail ' +
    '(git reset --hard, git push --force, git clean -f, git checkout -- ., git rebase -i). ' +
    'Ask the user for explicit permission before running it.';

  var REASON_DESTRUCTIVE_INFRA =
    'DESTRUCTIVE CLOUD/INFRA/DEVOPS BLOCKED: terraform destroy, tofu destroy, pulumi destroy, ' +
    'aws cloudformation delete-stack, aws s3 rb/rm --force/recursive, az group delete, ' +
    'kubectl delete ns/all/cluster, helm uninstall/delete, or docker system/volume prune ' +
    'is strictly forbidden without explicit user permission.';

  var REASON_DESTRUCTIVE_DB =
    'DESTRUCTIVE DATABASE OPERATION BLOCKED: DROP DATABASE/SCHEMA/TABLE/KEYSPACE, TRUNCATE, ' +
    'Redis FLUSHALL/FLUSHDB/SHUTDOWN, MongoDB dropDatabase, Cassandra DROP KEYSPACE, ' +
    'or Elasticsearch/OpenSearch bulk index deletion is strictly forbidden without explicit user permission.';

  var REASON_DESTRUCTIVE_NET =
    'NETWORK ENGINEERING GUARDRAIL BLOCKED: flushing firewall rules (iptables -F, ufw disable, nft flush), ' +
    'deleting network interfaces, or dropping default routes is strictly forbidden without explicit user permission.';

  var REASON_INTERPRETER_BYPASS =
    'INLINE INTERPRETER EVASION BLOCKED: inline scripting via python -c, node -e, php -r, ' +
    'perl -e, ruby -e, bash -c, lua -e, R -e, julia -e, pwsh -c, eval, or base64 decode is strictly forbidden. ' +
    'All file mutations and codebase changes MUST use Konoha MCP bounded tools.';

  var REASON_CONFIG_TAMPERING =
    'PROTECTED CONFIGURATION TAMPERING BLOCKED: modifying or deleting guardrail, linter, ' +
    'git hook, or IDE agent configurations (.git/hooks, .claude, .cursor, .commandcode, ' +
    '.opencode, .codex, .omp, .rtk, RTK.md, eslint, phpstan, tsconfig) is strictly forbidden.';

  var REASON_SECRETS =
    'SECRET FILE ACCESS BLOCKED: reading or committing secret files (.env*, secrets.yaml, ' +
    '*.tfvars, *.pem, *.key, id_rsa, credentials) requires explicit user permission. ' +
    'Redact all secret values and never print, dump or commit them.';

  var REASON_READ_BYPASS =
    'KONOHA RULE VIOLATION: Shell file reading is strictly forbidden (including rtk cat/grep). ' +
    'Use the konoha MCP bounded file tools (read_file_head, read_file_range, file_info, ' +
    'get_file_structure, find_files_clean, token_efficient_grep) or the semble MCP ' +
    '(search / find_related) instead.';

  // Layer 1: whole-command regex scans
  var wholeCommandPatterns = [
    // Destructive filesystem / general
    { category: 'destructive', pattern: /\bmkfs(\.\w+)?\b/, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\bdd\b[^|;&]*\bof=\s*\/dev\//, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\bchmod\s+(-[A-Za-z]+\s+)*777\b/, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\bchown\b[^|;&]*(-R\b|--recursive\b)/, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /\b(wipefs|shred\s+(-[A-Za-z]*u\s+)?\/dev\/)/, reason: REASON_DESTRUCTIVE },
    { category: 'destructive', pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&;?\s*\}\s*;\s*:/, reason: REASON_DESTRUCTIVE },

    // Destructive Database Stacks (SQL, NoSQL, Cache, Search, Graph)
    { category: 'destructive-db', pattern: /\b(DROP\s+(DATABASE|SCHEMA|TABLE|KEYSPACE|USER|ROLE)|TRUNCATE\s+(TABLE\s+)?\w+)\b/i, reason: REASON_DESTRUCTIVE_DB },
    { category: 'destructive-db', pattern: /\b(FLUSHALL|FLUSHDB)\b/i, reason: REASON_DESTRUCTIVE_DB },
    { category: 'destructive-db', pattern: /\bredis-cli\s+.*(shutdown|config\s+set)\b/i, reason: REASON_DESTRUCTIVE_DB },
    { category: 'destructive-db', pattern: /\b(dropDatabase\(|db\.runCommand\(\s*\{.*dropDatabase)/i, reason: REASON_DESTRUCTIVE_DB },
    { category: 'destructive-db', pattern: /curl\s+.*-X\s*DELETE\s+.*(\/_all|\/\*)/i, reason: REASON_DESTRUCTIVE_DB },
    { category: 'destructive-db', pattern: /\b(MATCH\s+.*DETACH\s+DELETE)\b/i, reason: REASON_DESTRUCTIVE_DB },

    // Destructive System / SRE
    { category: 'destructive-sys', pattern: /\b(shutdown|reboot|poweroff|halt)\b/i, reason: REASON_DESTRUCTIVE_SYS },
    { category: 'destructive-sys', pattern: /\binit\s+[06]\b/, reason: REASON_DESTRUCTIVE_SYS },

    // Destructive Git
    { category: 'destructive-git', pattern: /\bgit\s+reset\b[^|;&]*--hard\b/, reason: REASON_DESTRUCTIVE_GIT },
    { category: 'destructive-git', pattern: /\bgit\s+push\b[^|;&]*\s--force(?![-\w])/, reason: REASON_DESTRUCTIVE_GIT },
    { category: 'destructive-git', pattern: /\bgit\s+clean\b[^|;&]*\s-[A-Za-z]*f/, reason: REASON_DESTRUCTIVE_GIT },
    { category: 'destructive-git', pattern: /\bgit\s+checkout\s+(-[A-Za-z]+\s+)*--\s+\./, reason: REASON_DESTRUCTIVE_GIT },
    { category: 'destructive-git', pattern: /\bgit\s+rebase\s+(-[A-Za-z]*\s+)*(-i\b|--interactive\b)/, reason: REASON_DESTRUCTIVE_GIT },

    // Destructive Cloud Infrastructure, DevOps & SRE
    { category: 'destructive-infra', pattern: /\b(terraform|tofu|pulumi)\s+destroy\b/i, reason: REASON_DESTRUCTIVE_INFRA },
    { category: 'destructive-infra', pattern: /\bkubectl\s+delete\s+(ns|namespace|all|nodes?|cluster)\b/i, reason: REASON_DESTRUCTIVE_INFRA },
    { category: 'destructive-infra', pattern: /\bhelm\s+(uninstall|delete)\b/i, reason: REASON_DESTRUCTIVE_INFRA },
    { category: 'destructive-infra', pattern: /\bdocker\s+(system|volume)\s+prune\b/i, reason: REASON_DESTRUCTIVE_INFRA },
    { category: 'destructive-infra', pattern: /\bdocker\s+(rm|stop)\s+(-[a-zA-Z]*f\s+)?(\$\(docker|`docker)\b/i, reason: REASON_DESTRUCTIVE_INFRA },
    { category: 'destructive-infra', pattern: /\baws\s+cloudformation\s+delete-stack\b/i, reason: REASON_DESTRUCTIVE_INFRA },
    { category: 'destructive-infra', pattern: /\baws\s+s3\s+(rb|rm)\s+.*(--force|--recursive)\b/i, reason: REASON_DESTRUCTIVE_INFRA },
    { category: 'destructive-infra', pattern: /\baz\s+group\s+delete\b/i, reason: REASON_DESTRUCTIVE_INFRA },
    { category: 'destructive-infra', pattern: /\bgcloud\s+deployment-manager\s+deployments\s+delete\b/i, reason: REASON_DESTRUCTIVE_INFRA },

    // Destructive Network Engineering
    { category: 'destructive-network', pattern: /\b(iptables|ip6tables)\s+(-[a-zA-Z]*F\b|--flush\b)/i, reason: REASON_DESTRUCTIVE_NET },
    { category: 'destructive-network', pattern: /\bnft\s+flush\s+ruleset\b/i, reason: REASON_DESTRUCTIVE_NET },
    { category: 'destructive-network', pattern: /\bufw\s+disable\b/i, reason: REASON_DESTRUCTIVE_NET },
    { category: 'destructive-network', pattern: /\bfirewall-cmd\s+--panic-on\b/i, reason: REASON_DESTRUCTIVE_NET },
    { category: 'destructive-network', pattern: /\bip\s+link\s+(delete|set\s+\S+\s+down)\b/i, reason: REASON_DESTRUCTIVE_NET },
    { category: 'destructive-network', pattern: /\bip\s+route\s+del\s+default\b/i, reason: REASON_DESTRUCTIVE_NET },
    { category: 'destructive-network', pattern: /\broute\s+del\s+default\b/i, reason: REASON_DESTRUCTIVE_NET },

    // Interpreter bypass / dynamic code execution
    { category: 'interpreter-bypass', pattern: /\b(base64\s+(-d|--decode)\s*\|\s*(ba|z|k)?sh)\b/i, reason: REASON_INTERPRETER_BYPASS },
    { category: 'interpreter-bypass', pattern: /\beval\s+["']?[^"'\n]+["']?/, reason: REASON_INTERPRETER_BYPASS },
    { category: 'interpreter-bypass', pattern: /\bcurl\s+[^|;&]*\|\s*(sudo\s+)?(python|python3|node|bun|deno|php|perl|ruby)\b/i, reason: REASON_INTERPRETER_BYPASS }
  ];

  for (var w = 0; w < wholeCommandPatterns.length; w++) {
    if (wholeCommandPatterns[w].pattern.test(cmd)) {
      return { category: wholeCommandPatterns[w].category, reason: wholeCommandPatterns[w].reason };
    }
  }

  // Layer 2: segment / stage tokenization
  var READ_BYPASS_BINARIES = [
    'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'fd',
    'ag', 'ack', 'less', 'more', 'bat', 'wc', 'zcat'
  ];
  var SECRET_READERS = [
    'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'less', 'more',
    'bat', 'wc', 'strings', 'xxd', 'od', 'awk', 'sed', 'file', 'nl', 'zcat'
  ];

  var INTERPRETER_FLAGS = {
    // Python
    'python': ['-c', '-'],
    'python3': ['-c', '-'],
    'ipython': ['-c'],
    'pypy': ['-c'],
    'pypy3': ['-c'],
    // JS / TS / Web runtimes
    'node': ['-e', '--eval', '-p', '--print', '-'],
    'nodejs': ['-e', '--eval', '-p', '--print', '-'],
    'bun': ['-e', '--eval'],
    'deno': ['eval'],
    'ts-node': ['-e', '--eval'],
    'tsx': ['-e', '--eval'],
    // PHP
    'php': ['-r', '-a', '--run'],
    // Perl
    'perl': ['-e', '-E'],
    // Ruby
    'ruby': ['-e'],
    'irb': ['-e'],
    // Shells
    'bash': ['-c'],
    'sh': ['-c'],
    'zsh': ['-c'],
    'ksh': ['-c'],
    'csh': ['-c'],
    'tcsh': ['-c'],
    'dash': ['-c'],
    // Lua
    'lua': ['-e'],
    'luajit': ['-e'],
    // R
    'R': ['-e'],
    'Rscript': ['-e'],
    // Julia
    'julia': ['-e', '-E'],
    // Kotlin, Scala, Elixir
    'kotlinc': ['-e'],
    'scala': ['-e'],
    'elixir': ['-e'],
    // PowerShell
    'pwsh': ['-c', '-command', '-encodedcommand'],
    'powershell': ['-c', '-command', '-encodedcommand'],
    // Tcl
    'tclsh': ['-e'],
    'wish': ['-e']
  };

  var MUTATING_BINS = ['rm', 'mv', 'cp', 'chmod', 'chown', 'sed', 'tee', 'truncate'];

  function stripQuotes(token) {
    return token.replace(/^['"]/, '').replace(/['"]$/, '');
  }

  function isProtectedConfigToken(token) {
    var raw = stripQuotes(token);
    if (!raw) return false;
    if (raw.indexOf('.git/hooks') !== -1) return true;
    if (/\.(claude|cursor|commandcode|opencode|codex|omp)(\/|$)/i.test(raw)) return true;
    if (/\.(rtk|RTK\.md)$/i.test(raw)) return true;
    if (/(eslint\.config|\.eslintrc|phpstan\.neon|tsconfig\.json|\.tflint\.hcl|ruff\.toml|\.editorconfig)/i.test(raw)) return true;
    if (raw.indexOf('/etc/resolv.conf') !== -1 || raw.indexOf('/etc/hosts') !== -1) return true;
    return false;
  }

  function isSecretPathToken(token) {
    var base = stripQuotes(token).replace(/^.*\//, '');
    if (base.startsWith(".env")) return true;
    if (/^secrets\.(ya?ml|json)$/.test(base)) return true;
    if (/\.(tfvars|pem|key)$/.test(base)) return true;
    if (base.startsWith("id_rsa")) return true;
    if (base.startsWith("credentials")) return true;
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

    function checkInterpreterBypass(parsed) {
      var blockedFlags = INTERPRETER_FLAGS[parsed.bin];
      if (!blockedFlags) return null;
      var found = parsed.tokens.slice(1).some(function(tok) {
        return blockedFlags.indexOf(stripQuotes(tok)) !== -1;
      });
      return found ? { category: 'interpreter-bypass', reason: REASON_INTERPRETER_BYPASS } : null;
    }

    function checkConfigTampering(parsed, rawStage) {
      if (MUTATING_BINS.indexOf(parsed.bin) === -1 && rawStage.indexOf('>') === -1) return null;
      var found = parsed.tokens.some(function(tok) {
        return isProtectedConfigToken(tok);
      });
      return found ? { category: 'config-tampering', reason: REASON_CONFIG_TAMPERING } : null;
    }

    function checkSecretTokens(tokens, startIdx) {
      var found = tokens.slice(startIdx).some(function(tok) {
        return isSecretPathToken(tok);
      });
      return found ? { category: 'secrets', reason: REASON_SECRETS } : null;
    }

    function checkSecretsViolation(parsed) {
      if (SECRET_READERS.indexOf(parsed.bin) !== -1) {
        return checkSecretTokens(parsed.tokens, 1);
      }
      if (parsed.bin === 'git' && parsed.tokens.length > 1 &&
          (parsed.tokens[1] === 'add' || parsed.tokens[1] === 'commit')) {
        return checkSecretTokens(parsed.tokens, 2);
      }
      return null;
    }

    function checkSingleStage(stageStr, isFirstStage) {
      if (!stageStr.trim()) return null;
      var parsed = parseStage(stageStr);
      if (!parsed.bin) return null;
      var violation = checkInterpreterBypass(parsed) ||
                      checkConfigTampering(parsed, stageStr);
      if (violation) return violation;
      if (parsed.bin === 'rm') {
        var rmV = checkRm(parsed.tokens);
        if (rmV) return rmV;
      }
      var secV = checkSecretsViolation(parsed);
      if (secV) return secV;
      if (isFirstStage && READ_BYPASS_BINARIES.indexOf(parsed.bin) !== -1) {
        return { category: 'read-bypass', reason: REASON_READ_BYPASS };
      }
      return null;
    }

    function checkSegment(segStr) {
      if (!segStr.trim()) return null;
      var stages = segStr.split('|');
      for (var g = 0; g < stages.length; g++) {
        var v = checkSingleStage(stages[g], g === 0);
        if (v) return v;
      }
      return null;
    }

  var segments = cmd.split(/&&|\|\||;/);
  for (var s = 0; s < segments.length; s++) {
    var segViolation = checkSegment(segments[s]);
    if (segViolation) return segViolation;
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
