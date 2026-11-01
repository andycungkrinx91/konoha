'use strict';

const {
  BaseCheckpointSaver,
  writesSortKey,
  compareWritesSortKeys,
  TASKS,
  WRITES_IDX_MAP,
  copyCheckpoint,
  maxChannelVersion,
} = require('@langchain/langgraph-checkpoint');
const Database = require('../../sqlite_driver');

const SQL_CREATE_CHECKPOINTS = `
CREATE TABLE IF NOT EXISTS lg_checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);`;

const SQL_CREATE_WRITES = `
CREATE TABLE IF NOT EXISTS lg_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_path TEXT NOT NULL DEFAULT '',
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);`;

const SQL_ALTER_WRITES = `ALTER TABLE lg_writes ADD COLUMN task_path TEXT NOT NULL DEFAULT ''`;

const SQL_INSERT_CHECKPOINT = `
INSERT OR REPLACE INTO lg_checkpoints
  (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
VALUES (?, ?, ?, ?, ?, ?, ?)`;

const SQL_INSERT_WRITES_REPLACE = `
INSERT OR REPLACE INTO lg_writes
  (thread_id, checkpoint_ns, checkpoint_id, task_id, task_path, idx, channel, type, value)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const SQL_INSERT_WRITES_IGNORE = `
INSERT OR IGNORE INTO lg_writes
  (thread_id, checkpoint_ns, checkpoint_id, task_id, task_path, idx, channel, type, value)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const SQL_DELETE_CHECKPOINTS = `DELETE FROM lg_checkpoints WHERE thread_id = ?`;
const SQL_DELETE_WRITES = `DELETE FROM lg_writes WHERE thread_id = ?`;

const SQL_MIGRATE_PENDING_SENDS = `
SELECT
  checkpoint_id,
  json_group_array(
    json_object('type', ps.type, 'value', CAST(ps.value AS TEXT))
  ) as pending_sends
FROM lg_writes as ps
WHERE ps.thread_id = ?
  AND ps.checkpoint_id = ?
  AND ps.channel = ?
ORDER BY ps.idx`;

function buildSelectSql(exactMatch, withPath) {
  const pathExpr = withPath ? 'pw.task_path' : "''";
  const whereTail = exactMatch
    ? 'AND checkpoint_id = ?'
    : 'ORDER BY checkpoint_id DESC LIMIT 1';

  return `
SELECT
  thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata,
  (
    SELECT json_group_array(json_object(
      'task_id', pw.task_id, 'channel', pw.channel, 'type', pw.type,
      'value', CAST(pw.value AS TEXT), 'task_path', ${pathExpr}, 'idx', pw.idx
    ))
    FROM lg_writes as pw
    WHERE pw.thread_id = checkpoints.thread_id
      AND pw.checkpoint_ns = checkpoints.checkpoint_ns
      AND pw.checkpoint_id = checkpoints.checkpoint_id
  ) as pending_writes,
  (
    SELECT json_group_array(json_object(
      'type', ps.type, 'value', CAST(ps.value AS TEXT)
    ))
    FROM lg_writes as ps
    WHERE ps.thread_id = checkpoints.thread_id
      AND ps.checkpoint_ns = checkpoints.checkpoint_ns
      AND ps.checkpoint_id = checkpoints.parent_checkpoint_id
      AND ps.channel = ?
    ORDER BY ps.idx
  ) as pending_sends
FROM lg_checkpoints as checkpoints
WHERE thread_id = ? AND checkpoint_ns = ? ${whereTail}`;
}

function sortPendingWriteColumns(columns) {
  const keyed = columns.map((column) => ({
    key: writesSortKey(column.task_path ?? '', column.task_id, column.idx ?? 0),
    column,
  }));
  keyed.sort((a, b) => compareWritesSortKeys(a.key, b.key));
  return keyed.map(({ column }) => column);
}

function isReadonlyError(e) {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === 'SQLITE_READONLY';
}

function isDuplicateColumnError(e) {
  return typeof e === 'object' && e !== null && 'message' in e && String(e.message).includes('duplicate column name');
}

class KonohaCheckpointSaver extends BaseCheckpointSaver {
  constructor(db, serde) {
    super(serde);
    this.db = db;
    this.isSetup = false;
    this._hasTaskPath = true;
    this.stmtLatest = null;
    this.stmtExact = null;
    this.stmtInsertCheckpoint = null;
    this.stmtInsertWritesReplace = null;
    this.stmtInsertWritesIgnore = null;
    this.stmtDeleteCheckpoints = null;
    this.stmtDeleteWrites = null;
    this.stmtMigratePendingSends = null;
  }

  static fromConnString(connStringOrLocalPath, serde) {
    const db = new Database(connStringOrLocalPath);
    return new KonohaCheckpointSaver(db, serde);
  }

  setup() {
    if (this.isSetup) return;
    try {
      this.db.pragma('journal_mode=WAL');
    } catch (e) {
      if (!isReadonlyError(e)) throw e;
    }

    this.db.exec(SQL_CREATE_CHECKPOINTS);
    this.db.exec(SQL_CREATE_WRITES);

    try {
      this.db.exec(SQL_ALTER_WRITES);
    } catch (e) {
      if (isReadonlyError(e)) {
        this._hasTaskPath = false;
      } else if (!isDuplicateColumnError(e)) {
        throw e;
      }
    }

    this.stmtLatest = this.db.prepare(buildSelectSql(false, this._hasTaskPath));
    this.stmtExact = this.db.prepare(buildSelectSql(true, this._hasTaskPath));
    this.stmtInsertCheckpoint = this.db.prepare(SQL_INSERT_CHECKPOINT);
    this.stmtInsertWritesReplace = this.db.prepare(SQL_INSERT_WRITES_REPLACE);
    this.stmtInsertWritesIgnore = this.db.prepare(SQL_INSERT_WRITES_IGNORE);
    this.stmtDeleteCheckpoints = this.db.prepare(SQL_DELETE_CHECKPOINTS);
    this.stmtDeleteWrites = this.db.prepare(SQL_DELETE_WRITES);
    this.stmtMigratePendingSends = this.db.prepare(SQL_MIGRATE_PENDING_SENDS);

    this.isSetup = true;
  }

  async _parseRow(row) {
    const rawPendingWrites = JSON.parse(row.pending_writes || '[]');
    const pendingWrites = await Promise.all(
      sortPendingWriteColumns(rawPendingWrites).map(async (write) => {
        return [
          write.task_id,
          write.channel,
          await this.serde.loadsTyped(write.type ?? 'json', write.value ?? ''),
        ];
      })
    );

    const checkpoint = await this.serde.loadsTyped(row.type ?? 'json', row.checkpoint);
    if (checkpoint.v < 4 && row.parent_checkpoint_id != null) {
      await this.migratePendingSends(checkpoint, row.thread_id, row.parent_checkpoint_id);
    }

    const metadata = await this.serde.loadsTyped(row.type ?? 'json', row.metadata);
    return { checkpoint, pendingWrites, metadata };
  }

  async getTuple(config) {
    this.setup();
    const { thread_id, checkpoint_ns = '', checkpoint_id } = config.configurable ?? {};
    let row;
    if (checkpoint_id) {
      row = this.stmtExact.get(TASKS, thread_id, checkpoint_ns, checkpoint_id);
    } else {
      row = this.stmtLatest.get(TASKS, thread_id, checkpoint_ns);
    }
    if (row === undefined) return undefined;

    let finalConfig = config;
    if (!checkpoint_id) {
      finalConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      };
    }
    if (finalConfig.configurable?.thread_id === undefined || finalConfig.configurable?.checkpoint_id === undefined) {
      throw new Error('Missing thread_id or checkpoint_id');
    }

    const { checkpoint, pendingWrites, metadata } = await this._parseRow(row);

    return {
      checkpoint,
      config: finalConfig,
      metadata,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async *list(config, options) {
    const { limit, before, filter } = options ?? {};
    this.setup();
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;

    const baseSql = buildSelectSql(false, this._hasTaskPath);
    const fromIdx = baseSql.indexOf('FROM lg_checkpoints');
    const selectProjection = baseSql.slice(0, fromIdx);

    let sql = `${selectProjection} FROM lg_checkpoints as checkpoints\n`;
    const whereClause = [];
    const args = [TASKS];

    if (thread_id) {
      whereClause.push('checkpoints.thread_id = ?');
      args.push(thread_id);
    }
    if (checkpoint_ns !== undefined && checkpoint_ns !== null) {
      whereClause.push('checkpoints.checkpoint_ns = ?');
      args.push(checkpoint_ns);
    }
    if (before?.configurable?.checkpoint_id !== undefined) {
      whereClause.push('checkpoints.checkpoint_id < ?');
      args.push(before.configurable.checkpoint_id);
    }

    const sanitizedFilter = Object.fromEntries(
      Object.entries(filter ?? {}).filter(([, value]) => value !== undefined)
    );
    for (const [key, value] of Object.entries(sanitizedFilter)) {
      whereClause.push('json_extract(CAST(checkpoints.metadata AS TEXT), ?) = ?');
      args.push(`$.${key}`, value);
    }

    if (whereClause.length > 0) {
      sql += `WHERE ${whereClause.join(' AND ')}\n`;
    }
    sql += 'ORDER BY checkpoints.checkpoint_id DESC';
    if (limit) {
      sql += ' LIMIT ?';
      args.push(parseInt(limit, 10));
    }

    const rows = this.db.prepare(sql).all(...args);
    if (rows) {
      for (const row of rows) {
        const { checkpoint, pendingWrites, metadata } = await this._parseRow(row);
        yield {
          config: {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.checkpoint_ns,
              checkpoint_id: row.checkpoint_id,
            },
          },
          checkpoint,
          metadata,
          parentConfig: row.parent_checkpoint_id
            ? {
                configurable: {
                  thread_id: row.thread_id,
                  checkpoint_ns: row.checkpoint_ns,
                  checkpoint_id: row.parent_checkpoint_id,
                },
              }
            : undefined,
          pendingWrites,
        };
      }
    }
  }

  async put(config, checkpoint, metadata, _newVersions) {
    this.setup();
    if (!config.configurable) throw new Error('Empty configuration supplied.');
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? '';
    const parent_checkpoint_id = config.configurable?.checkpoint_id;
    if (!thread_id) throw new Error('Missing "thread_id" field in passed "config.configurable".');

    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const [[type1, serializedCheckpoint], [type2, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(preparedCheckpoint),
      this.serde.dumpsTyped(metadata),
    ]);
    if (type1 !== type2) throw new Error('Failed to serialize checkpoint and metadata to the same type.');

    const row = [
      thread_id,
      checkpoint_ns,
      checkpoint.id,
      parent_checkpoint_id,
      type1,
      serializedCheckpoint,
      serializedMetadata,
    ];
    this.stmtInsertCheckpoint.run(...row);

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config, writes, taskId, taskPath) {
    this.setup();
    if (!config.configurable) throw new Error('Empty configuration supplied.');
    if (!config.configurable?.thread_id) throw new Error('Missing thread_id field in config.configurable.');
    if (!config.configurable?.checkpoint_id) throw new Error('Missing checkpoint_id field in config.configurable.');

    const allSpecial = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const stmt = allSpecial ? this.stmtInsertWritesReplace : this.stmtInsertWritesIgnore;

    const serializedWrites = await Promise.all(
      writes.map(async (write, idx) => {
        const [type, serializedWrite] = await this.serde.dumpsTyped(write[1]);
        return [
          config.configurable?.thread_id,
          config.configurable?.checkpoint_ns,
          config.configurable?.checkpoint_id,
          taskId,
          this._hasTaskPath ? taskPath ?? '' : '',
          WRITES_IDX_MAP[write[0]] ?? idx,
          write[0],
          type,
          serializedWrite,
        ];
      })
    );

    this.db.transaction((rows) => {
      for (const row of rows) stmt.run(...row);
    })(serializedWrites);
  }

  async deleteThread(threadId) {
    this.setup();
    this.db.transaction(() => {
      this.stmtDeleteCheckpoints.run(threadId);
      this.stmtDeleteWrites.run(threadId);
    })();
  }

  async migratePendingSends(checkpoint, threadId, parentCheckpointId) {
    const row = this.stmtMigratePendingSends.get(threadId, parentCheckpointId, TASKS);
    if (!row) return;
    const pendingSends = row.pending_sends;
    const mutableCheckpoint = checkpoint;
    mutableCheckpoint.channel_values ??= {};
    mutableCheckpoint.channel_values[TASKS] = await Promise.all(
      JSON.parse(pendingSends || '[]').map(({ type, value }) => this.serde.loadsTyped(type, value))
    );
    mutableCheckpoint.channel_versions[TASKS] =
      Object.keys(checkpoint.channel_versions).length > 0
        ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
        : this.getNextVersion(undefined);
  }
}

module.exports = { KonohaCheckpointSaver };
