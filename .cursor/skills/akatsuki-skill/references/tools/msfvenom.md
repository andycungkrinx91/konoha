# Metasploit Standalone Payload Generator (msfvenom) Reference

msfvenom is a command-line instance of Metasploit that combines the capabilities of the legacy `msfpayload` and `msfencode` utilities. It is used to generate, encode, and output standalone shellcodes and payloads across various architectures and executable formats for controlled security verification.

## Source
- Kali Linux Official: `https://www.kali.org/tools/metasploit-framework/`
- Skills.sh: `https://www.skills.sh/terminalskills/skills/metasploit` (+ `https://www.skills.sh/agentsecops/secopsagentkit/pentest-metasploit`)
- Chunin Threat Intelligence: Controlled proof-of-concept shellcode synthesis and buffer boundary verification

## When to Use
- Controlled Exploit Verification: generate non-destructive test payloads to verify patch effectiveness.
- Shellcode Formatting & Encoding: convert raw bytecode into C, Python, JavaScript, or raw hex buffers for memory safety audits.
- Architecture Validation: verify application boundary handling across x86, x64, ARM, and MIPS architectures.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `msfvenom`, `/usr/bin/msfvenom`, `/opt/metasploit-framework/bin/msfvenom`
- Target Scoping: Default `127.0.0.1` (local sandbox)
- Safety Class: `controlled_poc_verification`
- Timeout: 45000ms
- Evidence Outputs: `/tmp/akatsuki_payload.bin`, `/tmp/akatsuki_msfvenom.log`
- Cleanup Steps: Remove `/tmp/akatsuki_payload.*` and `/tmp/akatsuki_msfvenom.log`, kill lingering `msfvenom` processes

## Command Patterns
```bash
# 1. List available payloads for a specific platform
msfvenom --list payloads | grep "linux/x64"

# 2. Generate a benign test payload in C format for memory buffer verification
msfvenom -p linux/x64/shell_bind_tcp LPORT=4444 -f c -o /tmp/akatsuki_payload.bin

# 3. Generate raw shellcode with specific bad characters avoided
msfvenom -p linux/x64/exec CMD="whoami" -b '\x00\x0a\x0d' -f raw -o /tmp/akatsuki_payload.bin
```

## Fail-Closed Notes
- Execution outside `akatsuki-lab` is strictly blocked fail-closed.
- Payload generation against production or unapproved network environments is denied.
