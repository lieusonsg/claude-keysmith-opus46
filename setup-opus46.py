#!/usr/bin/env python3
"""setup-opus46.py — one-command installer for this fork (claude-keysmith-opus46).

Does two things, in order:

1. Installs the bench-workspace envelope v3 into Claude Code:
   claude-instruct.py install --scope user --runtime --agents --yes
   (CLAUDE.md import block + ~/.claude/keysmith/ prompt files +
    ~/.claude/agents/keysmith.md + settings.systemPrompt + PowerShell wrapper)

2. Patches ~/.claude/settings.json (with timestamped backup):
   - model = claude-opus-4-6[1m]          (Opus 4.6, 1M context beta)
   - autoCompactWindow = 500000           (auto-compact at 500k tokens)
   - env.ANTHROPIC_SMALL_FAST_MODEL = claude-opus-4-6  (light-tier + background calls)
   - env.ANTHROPIC_DEFAULT_SONNET_MODEL = claude-opus-4-6  (Task sub-agent slot)
   - env.ANTHROPIC_DEFAULT_HAIKU_MODEL = claude-opus-4-6  (Task sub-agent slot)

Default is preview (dry-run). Pass --yes to execute.

Usage:
    python setup-opus46.py            # preview
    python setup-opus46.py --yes      # install + patch

After running: open a NEW PowerShell (or `. $PROFILE`) so the managed
`claude` wrapper loads. Verify with:
    python claude-instruct.py status --scope user --runtime   (from this repo)
    claude -p "reply with exactly: OK"
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent
SETTINGS = Path.home() / ".claude" / "settings.json"

MODEL = "claude-opus-4-6[1m]"
COMPACT_WINDOW = 500000
SMALL_FAST_MODEL = "claude-opus-4-6"


def install_envelope(execute: bool) -> bool:
    cmd = [sys.executable, str(REPO_DIR / "claude-instruct.py"),
           "install", "--scope", "user", "--runtime", "--agents"]
    if execute:
        cmd.append("--yes")
    print("[1/2] Envelope install ({}):".format("execute" if execute else "preview"))
    print("      " + " ".join(cmd[1:]))
    if not execute:
        return True
    result = subprocess.run(cmd, cwd=str(REPO_DIR))
    return result.returncode == 0


def patch_settings(execute: bool) -> bool:
    print("[2/2] settings.json patch ({}):".format("execute" if execute else "preview"))
    for key, value in (("model", MODEL),
                       ("autoCompactWindow", COMPACT_WINDOW),
                       ("env.ANTHROPIC_SMALL_FAST_MODEL", SMALL_FAST_MODEL),
                       ("env.ANTHROPIC_DEFAULT_SONNET_MODEL", SMALL_FAST_MODEL),
                       ("env.ANTHROPIC_DEFAULT_HAIKU_MODEL", SMALL_FAST_MODEL)):
        print("      {} = {}".format(key, value))
    if not execute:
        return True
    if not SETTINGS.exists():
        print("      [error] {} not found - run Claude Code once first".format(SETTINGS))
        return False
    backup = SETTINGS.with_name(
        "settings.json.bak_{}_pre_opus46".format(time.strftime("%Y%m%d_%H%M%S")))
    backup.write_bytes(SETTINGS.read_bytes())
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    data["model"] = MODEL
    data["autoCompactWindow"] = COMPACT_WINDOW
    env = data.get("env") or {}
    env["ANTHROPIC_SMALL_FAST_MODEL"] = SMALL_FAST_MODEL
    env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = SMALL_FAST_MODEL
    env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = SMALL_FAST_MODEL
    data["env"] = env
    SETTINGS.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print("      [backup] {}".format(backup.name))
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Install this fork for Claude Code (Opus 4.6 tuned).")
    parser.add_argument("--yes", action="store_true", help="execute; without it, preview only")
    args = parser.parse_args()

    if not args.yes:
        print("[DRY RUN] preview mode - rerun with --yes to apply.\n")

    ok = install_envelope(args.yes)
    ok = patch_settings(args.yes) and ok

    if not args.yes:
        print("\n[DRY RUN] nothing was written.")
        return 0
    if ok:
        print("\n[done] Open a NEW PowerShell (or `. $PROFILE`) so the claude wrapper reloads.")
        print("       Verify: claude -p \"reply with exactly: OK\"")
        return 0
    print("\n[error] steps above failed - resolve and rerun.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
