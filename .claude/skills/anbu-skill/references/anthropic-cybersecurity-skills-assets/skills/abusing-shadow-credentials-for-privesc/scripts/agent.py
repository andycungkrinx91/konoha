#!/usr/bin/env python3
"""
shadowcred_audit.py — Audit msDS-KeyCredentialLink attributes and verify credential security hygiene.

Wraps certipy and pyWhisker to audit existing Key Credentials on target objects,
identify permissive configuration risks, and execute credential cleanup/remediation.

Authorized defensive security auditing only. Focuses on access-controls,
monitoring, and credential-management hygiene.

Install:
    pipx install certipy-ad
    git clone https://github.com/ShutdownRepo/pywhisker

Examples:
    python shadowcred_audit.py certipy-audit -u auditor@corp.local -p 'AuditPass!' \
        --dc-ip 10.0.0.100 --target 'WS01$'
    python shadowcred_audit.py pywhisker-list -d corp.local -u auditor \
        -p 'AuditPass!' --dc-ip 10.0.0.100 --target victim \
        --pywhisker ./pywhisker/pywhisker.py
"""

import argparse
import os
import shutil
import subprocess
import sys


def _which_or_die(binary, hint):
    if shutil.which(binary) is None and not os.path.exists(binary):
        sys.exit(f"[!] '{binary}' not found. {hint}")


def run(cmd, timeout=600):
    print("[*] Running:", " ".join(cmd))
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        sys.exit(f"[!] Command timed out after {timeout}s.")
    out = proc.stdout + proc.stderr
    print(out)
    return proc.returncode, out


def certipy_audit_flow(args):
    _which_or_die("certipy", "Install with: pipx install certipy-ad")
    action = "clear" if args.clear else "list"
    cmd = [
        "certipy",
        "shadow",
        action,
        "-u",
        args.user,
        "-dc-ip",
        args.dc_ip,
        "-account",
        args.target,
    ]
    if args.password:
        cmd += ["-p", args.password]
    elif args.hashes:
        cmd += ["-hashes", args.hashes]
    elif args.kerberos:
        cmd += ["-k", "-no-pass"]
    else:
        sys.exit("[!] Provide -p, --hashes, or -k.")
    if args.ns:
        cmd += ["-ns", args.ns, "-dns-tcp"]
    rc, out = run(cmd)
    if rc != 0:
        sys.exit(f"[!] certipy shadow {action} failed.")
    print(f"\n[+] Audit check complete for {args.target}.")


def pywhisker_audit_flow(args):
    if not args.pywhisker or not os.path.exists(args.pywhisker):
        sys.exit("[!] --pywhisker must point to pywhisker.py")
    action = "clear" if args.clear else "list"
    cmd = [
        "python3",
        args.pywhisker,
        "-d",
        args.domain,
        "-u",
        args.user,
        "--target",
        args.target,
        "--action",
        action,
    ]
    if args.password:
        cmd += ["-p", args.password]
    elif args.kerberos:
        cmd += ["-k", "--no-pass"]
    else:
        sys.exit("[!] Provide -p or -k.")
    if args.dc_ip:
        cmd += ["--dc-ip", args.dc_ip]
    rc, out = run(cmd)
    if rc != 0:
        sys.exit(f"[!] pyWhisker {action} failed.")
    print(f"\n[+] Attribute audit verification completed for {args.target}.")


def main():
    ap = argparse.ArgumentParser(
        description="Active Directory Shadow Credentials Security Audit Tool."
    )
    sub = ap.add_subparsers(dest="mode", required=True)

    c = sub.add_parser(
        "certipy-audit", help="Audit or clean Key Credentials using certipy"
    )
    c.add_argument("-u", "--user", required=True, help="auditor@domain")
    c.add_argument("-p", "--password")
    c.add_argument("--hashes")
    c.add_argument("-k", "--kerberos", action="store_true")
    c.add_argument("--dc-ip", required=True, dest="dc_ip")
    c.add_argument("--target", required=True, help="Target account name")
    c.add_argument(
        "--clear",
        action="store_true",
        help="Clean up / remove unauthorized Key Credentials",
    )
    c.add_argument("--ns")

    w = sub.add_parser(
        "pywhisker-list",
        help="List or clear Key Credentials using pyWhisker",
    )
    w.add_argument("-d", "--domain", required=True)
    w.add_argument("-u", "--user", required=True)
    w.add_argument("-p", "--password")
    w.add_argument("-k", "--kerberos", action="store_true")
    w.add_argument("--dc-ip", dest="dc_ip")
    w.add_argument("--target", required=True)
    w.add_argument(
        "--clear",
        action="store_true",
        help="Clean up / remove unauthorized Key Credentials",
    )
    w.add_argument("--pywhisker", required=True, help="Path to pywhisker.py")

    args = ap.parse_args()
    if args.mode == "certipy-audit":
        certipy_audit_flow(args)
    else:
        pywhisker_audit_flow(args)


if __name__ == "__main__":
    main()
