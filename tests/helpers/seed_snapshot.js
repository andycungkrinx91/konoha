// Golden-seed snapshot copy, kept out of tests/run_all.js so it can be tested
// without booting the whole harness.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// fs.cpSync recreates symlinks and throws EEXIST when the destination path already
// exists; `force` and `verbatimSymlinks` do not cover link creation. Once the
// installer began linking flat runtime entries into the mirrored src/ tree, every
// Windows seed snapshot failed there. So copy real files only, then rebuild each
// link ourselves with its original relative target.
function copySeedDir(seedDir, suiteHome, ensureNodeModules) {
  const src = `${seedDir}/.`;
  const dest = `${suiteHome}/`;
  const linkDir = path.join('.konoha', 'node_modules');
  const attempts = [
    ['cp', '-a', '--reflink=auto', '--no-preserve=ownership', src, dest],
    ['cp', '-a', '--no-preserve=ownership', src, dest],
    ['cp', '-a', src, dest],
    ['cp', '-r', '--no-preserve=ownership', src, dest],
    ['cp', '-r', src, dest],
  ];
  for (const args of attempts) {
    const res = spawnSync(args[0], args.slice(1), { encoding: 'utf-8' });
    if (res.status === 0 && !res.error) {
      // cp reproduces a link with whatever target the seed held, and on Windows
      // that can leave the snapshot pointing back at the seed. A snapshot must be
      // self-contained, so repair anything that escapes before returning.
      repairEscapingLinks(seedDir, suiteHome, (rel) => rel === linkDir || rel.startsWith(`${linkDir}${path.sep}`));
      if (ensureNodeModules) ensureNodeModules(suiteHome);
      return;
    }
  }

  const excluded = (rel) => rel === linkDir || rel.startsWith(`${linkDir}${path.sep}`);
  fs.cpSync(seedDir, suiteHome, {
    recursive: true,
    filter: (from) => {
      const rel = path.relative(seedDir, from);
      if (excluded(rel)) return false;
      try {
        return !fs.lstatSync(from).isSymbolicLink();
      } catch (_) {
        return false;
      }
    }
  });
  replicateSeedLinks(seedDir, suiteHome, excluded);
  if (ensureNodeModules) ensureNodeModules(suiteHome);
}

// A snapshot link that resolves outside the snapshot makes the suite read the
// seed's files: on Windows the resolved path came back as
// D:\a\_temp\konoha_golden_seed\... instead of the suite's own copy, so mirror
// resolution looked wrong when it was the copy that was wrong.
function repairEscapingLinks(seedDir, suiteHome, isExcluded) {
  const inside = (candidate) => {
    const rel = path.relative(suiteHome, candidate);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const to = path.join(dir, entry.name);
      const rel = path.relative(suiteHome, to);
      if (isExcluded(rel)) continue;
      if (entry.isSymbolicLink()) {
        let resolved = null;
        try {
          resolved = fs.realpathSync(to);
        } catch (_) {
          resolved = null;
        }
        if (resolved && inside(resolved)) continue;
        replicateOneLink(path.join(seedDir, rel), to, seedDir, suiteHome);
        continue;
      }
      if (entry.isDirectory()) walk(to);
    }
  };
  walk(suiteHome);
}

function replicateSeedLinks(seedDir, suiteHome, isExcluded) {
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const from = path.join(dir, entry.name);
      const rel = path.relative(seedDir, from);
      if (isExcluded(rel)) continue;
      if (entry.isSymbolicLink()) {
        replicateOneLink(from, path.join(suiteHome, rel), seedDir, suiteHome);
        continue;
      }
      if (entry.isDirectory()) walk(from);
    }
  };
  walk(seedDir);
}

function replicateOneLink(from, to, seedDir, suiteHome) {
  let target;
  let targetIsDirectory = false;
  try {
    target = fs.readlinkSync(from);
    targetIsDirectory = fs.statSync(from).isDirectory();
  } catch (_) {
    return; // dangling in the seed; nothing to replicate
  }
  // An absolute target that points inside the seed must become a path relative to
  // the snapshot, or the copy keeps reading the seed it was meant to be isolated
  // from.
  if (seedDir && suiteHome && path.isAbsolute(target)) {
    const relFromSeed = path.relative(seedDir, target);
    if (!relFromSeed.startsWith('..') && !path.isAbsolute(relFromSeed)) {
      target = path.relative(path.dirname(to), path.join(suiteHome, relFromSeed)) || '.';
    }
  }
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.rmSync(to, { recursive: true, force: true });
    fs.symlinkSync(target, to, targetIsDirectory ? 'junction' : 'file');
    return;
  } catch (_) {
    // No link privilege (Windows without Developer Mode): materialise the content
    // so the suite still gets a working runtime instead of a missing file.
  }
  try {
    const resolved = fs.realpathSync(from);
    fs.rmSync(to, { recursive: true, force: true });
    if (fs.statSync(resolved).isDirectory()) {
      fs.cpSync(resolved, to, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(resolved, to);
    }
  } catch (_) {
    /* leave absent: suites skip on a missing runtime */
  }
}

module.exports = { copySeedDir, replicateSeedLinks, repairEscapingLinks };
