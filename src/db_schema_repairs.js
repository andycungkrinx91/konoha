'use strict';

/**
 * Data repairs that run on every `setupSchema` pass. Each is idempotent and
 * returns early when the database has nothing to fix, because a healthy
 * database still opens once per command.
 */

/**
 * `harness:claude` came from the directory name (`~/.claude/skills`), not from
 * the client identity the rest of the database uses (`claudecode`), so one
 * harness had two spellings in `skills.name` and `skills.tags`. Rename the rows
 * in place instead of deleting them: their embeddings are the expensive part.
 * `skill_chunks` references `skills(name)` with no ON UPDATE, so the checks are
 * deferred to the enclosing savepoint and both sides move together.
 * `skills.name` is the primary key, so a database that already holds both
 * spellings — an interrupted run, or a tree that migrated twice — would make the
 * rename throw and take the whole connection down with it; merge into the row
 * that already exists and keep its chunks.
 */
function _renameLegacyClaudeHarnessLabel(conn) {
  const isLegacyName = (name) => name.endsWith('@global-claude') || name.includes('@global-claude/');
  const legacyTag = (tags) => String(tags || '').split(',').includes('harness:claude');
  const rows = conn.prepare(
    "SELECT name, tags FROM skills WHERE name LIKE '%@global-claude%' OR tags LIKE '%harness:claude%'"
  ).all().filter((row) => legacyTag(row.tags) || isLegacyName(row.name));
  if (rows.length === 0) return;
  conn.exec('PRAGMA defer_foreign_keys = ON');
  const targetExists = conn.prepare('SELECT 1 AS hit FROM skills WHERE name = ?');
  const moveChunks = conn.prepare('UPDATE skill_chunks SET skill_name = ? WHERE skill_name = ?');
  const moveSkill = conn.prepare('UPDATE skills SET name = ?, tags = ? WHERE name = ?');
  const retag = conn.prepare('UPDATE skills SET tags = ? WHERE name = ?');
  const dropSkill = conn.prepare('DELETE FROM skills WHERE name = ?');
  for (const row of rows) {
    const tags = String(row.tags || '')
      .split(',')
      .map((tag) => (tag === 'harness:claude' ? 'harness:claudecode' : tag))
      .join(',');
    if (!isLegacyName(row.name)) {
      retag.run(tags, row.name);
      continue;
    }
    const renamed = row.name.replace('@global-claude', '@global-claudecode');
    moveChunks.run(renamed, row.name);
    if (targetExists.get(renamed)) dropSkill.run(row.name);
    else moveSkill.run(renamed, tags, row.name);
  }
}

/**
 * `agy` is the Antigravity CLI executable, and the CLI and the IDE are one
 * harness — `HARNESS_ALIASES` and the advisor already fold one into the other.
 * The detection paths used to emit `agy` as an identity anyway, so
 * `tool_calls`, `sdlc_tasks` and `active_sessions` carry both spellings. Fold
 * them. `active_sessions` is keyed `(client, workspace_root, session_id)`, so a
 * blind UPDATE would hit the primary key on a session recorded under both;
 * `UPDATE OR IGNORE` keeps the canonical row and the DELETE drops the loser.
 */
function _mergeLegacyAgyClientRows(conn) {
  const tables = ['active_sessions', 'sdlc_tasks', 'tool_calls', 'prompt_queue',
    'telegram_session_targets', 'llm_requests_3d', 'generation_jobs'];
  for (const table of tables) {
    const cols = conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    for (const col of cols.filter((name) => name.startsWith('client'))) {
      const legacy = conn.prepare(`SELECT count(*) c FROM ${table} WHERE ${col} = 'agy'`).get();
      if (!legacy || legacy.c === 0) continue;
      conn.prepare(`UPDATE OR IGNORE ${table} SET ${col} = 'antigravity' WHERE ${col} = 'agy'`).run();
      conn.prepare(`DELETE FROM ${table} WHERE ${col} = 'agy'`).run();
    }
  }
}

module.exports = { _renameLegacyClaudeHarnessLabel, _mergeLegacyAgyClientRows };
