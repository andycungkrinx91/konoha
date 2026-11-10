# VPS Install

Konoha on a headless VPS. The default install is safe: no offensive skill pack,
no red-team execution, ANBU backend/DevOps intact.

## Requirements

| Requirement | Why | Check |
|---|---|---|
| Node.js >= 24 | `node:sqlite` is built in | `node -v` |
| pnpm | package manager used by the installer | `pnpm -v` |
| >= 2 GiB free in `$HOME` | DB, backups, runtime mirror | `df -h "$HOME"` |
| Writable `$HOME` | `~/.konoha` holds the DB and runtime | `test -w "$HOME"` |
| Ports 1404, 1405 free | MCP server + web UI | `ss -ltn '( sport = :1404 or sport = :1405 )'` |

Run the preflight before installing:

```bash
konoha doctor --vps
```

Every row prints `PASS` or `FAIL`. Any `FAIL` exits non-zero — fix it before
installing.

## Install

```bash
npm install -g konoha-mcp
konoha init --yes
```

`init` installs the runtime, creates `~/.konoha/konoha.db`, and syncs skill
mirrors for the clients you select. It does **not** download the cyber pack.

Verify:

```bash
konoha doctor
konoha akatsuki cyber-pack status   # expect: absent
```

## What ships by default

| Component | Default | Notes |
|---|---|---|
| ANBU backend/DevOps skill | installed | Backend, bug-fix, DevOps, security hygiene; escalates to `@akatsuki` |
| Akatsuki blue-team gates | installed | SAST, CVE, Skill Guardian |
| Akatsuki red-team lab | not provisioned | `konoha akatsuki init` provisions it |
| 817-skill cyber pack | **absent** | Opt-in only, see below |

The pack is not in the npm tarball and not in the git tree. A default install
indexes zero cyber rows.

## Opt in to the red-team pack

Only on a host you own or are authorised to test.

```bash
konoha akatsuki cyber-pack install --confirm
konoha migrate
```

`install` prints the consent text, downloads
`akatsuki-cyber-pack-<version>.tar.zst` plus `manifest.json` from the GitHub
release, verifies the sha256, and extracts to
`~/.konoha/akatsuki-lab/cyber-pack/`. `migrate` indexes 817 skills under
`akatsuki-skill` only.

Upgrading an install that predates 2.2.19: those releases indexed the pack under
every skill that walked it, so `anbu-skill` can hold thousands of cyber rows.
`install` snapshots the database (`~/.konoha/backups/`) and purges any cyber row
not owned by `akatsuki-skill`; the command reports how many it removed. `konoha
doctor --vps` fails while such rows remain, so the purge is the repair path.

`--confirm` is mandatory. Without it the command prints the consent text and
exits non-zero without touching the network.

Offline install from a local archive:

```bash
konoha akatsuki cyber-pack install --confirm \
  --archive ./akatsuki-cyber-pack-2.2.20.tar.zst \
  --manifest ./manifest.json
```

Remove it:

```bash
konoha akatsuki cyber-pack remove
```

`remove` backs up the DB first, deletes the pack rows and directory, and records
the removal in `schema_migrations`. The backup path is printed.

## Red-team execution

Red skills are gated on the lab. `@akatsuki` is the only identity that can load
them, and only when the lab is provisioned:

```bash
konoha akatsuki init --engine docker   # or lxc
konoha akatsuki mode red
```

The lab DB is physically separate: `~/.konoha/akatsuki-lab/lab.db`. It is never
the main DB, and symlink/hardlink aliases to the main DB are rejected.

## Repair

```bash
konoha doctor --restore-anbu        # re-sync ANBU from the shipped template
konoha doctor --clean-cyber-pack    # delete pack rows, chunks, and directory
```

Both are idempotent. `--clean-cyber-pack` never restores the pack.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `konoha doctor --vps` fails on Node | Node < 24 | Install Node 24 |
| `pnpm: command not found` | pnpm missing | `npm i -g pnpm` |
| `ENOSPC` during `init` | < 2 GiB free | Free space or set `KONOHA_HOME` to a larger volume |
| `EACCES` on `~/.konoha` | `$HOME` not writable | Fix ownership |
| Port 1404/1405 in use | Another service bound | Stop the conflicting service; `bin/lib/ui_service.js` hardcodes 1404 for the web UI, and the MCP server takes `--port` |
| `Cyber pack checksum mismatch` | Corrupt or tampered archive | Re-download; do not bypass |
| `CYBER_PACK_CONFIRM_REQUIRED` | Missing `--confirm` | Re-run with `--confirm` after reading the consent text |
| `LAB_DB_ISOLATION_VIOLATION` | Lab DB path aliases the main DB | Remove the symlink/hardlink; use the default lab path |

## Uninstall

```bash
konoha akatsuki cyber-pack remove   # if opted in
konoha uninstall
```

`uninstall` leaves `~/.konoha/backups/` in place.
