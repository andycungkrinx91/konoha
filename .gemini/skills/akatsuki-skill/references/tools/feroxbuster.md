# Feroxbuster Recursive Content Discovery Reference

Feroxbuster is a fast, simple, recursive content discovery tool written in Rust. It utilizes multi-threaded requests and recursive scanning to thoroughly enumerate directory hierarchies and endpoint trees.

## Source
- Skills.sh: `https://www.skills.sh/crtvrffnrt/skills/pentest-web-enumeration`
- Kali Linux Official: `https://www.kali.org/tools/feroxbuster/`

## When to Use
- Recursive Web Directory Enumeration: discover nested paths and subdirectories automatically.
- Multi-Extension File Probing: identify backup files (`.bak`, `.old`), source files (`.ts`, `.js`), and config files (`.json`, `.yml`).
- Deep API Directory Mapping: recursively map REST and GraphQL endpoints in dev environments.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `feroxbuster`, `/usr/bin/feroxbuster`, `/root/.cargo/bin/feroxbuster`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `active_recon`
- Timeout: 35000ms
- Evidence Outputs: `/tmp/akatsuki_ferox.txt`
- Cleanup Steps: Remove `/tmp/akatsuki_ferox.*`, terminate lingering `feroxbuster` processes

## Command Patterns
```bash
# 1. Non-recursive directory search with common wordlist
feroxbuster -u http://127.0.0.1:8080 -w /usr/share/wordlists/dirb/common.txt -n -o /tmp/akatsuki_ferox.txt

# 2. Targeted recursive probe with depth 2 and extension checks
feroxbuster -u http://127.0.0.1:3000 -w /usr/share/wordlists/dirb/common.txt -d 2 -x js,json,html -o /tmp/akatsuki_ferox.txt

# 3. Silent format output with status code filters
feroxbuster -u http://127.0.0.1:8080 -s 200,301,302,403 --silent -o /tmp/akatsuki_ferox.txt
```

## Fail-Closed Notes
- Out-of-scope targets are rejected by `validateAuthorization`.
- Execution on host is strictly blocked; container sandbox is mandatory.
