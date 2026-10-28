#!/usr/bin/env bash
#
# design-token-compliance-checker.sh
# Run from the skill root directory (jonin-skill/).
# Verifies that Next.js and Svelte UI expert references match the
# Design Token Manifest. Exit code 0 = all pass, 1 = divergence found.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../references" && pwd)"
MANIFEST="$SKILL_DIR/design-token-manifest.md"
NEXTJS="$SKILL_DIR/nextjs-ui-expert.md"
SVELTE="$SKILL_DIR/svelte-ui-expert.md"
SKILL_MD="$SCRIPT_DIR/../SKILL.md"

PASS=0
FAIL=0
WARN=0

ok()   { PASS=$((PASS+1)); echo "  ✅ PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ FAIL: $1"; }
warn() { WARN=$((WARN+1)); echo "  ⚠️  WARN: $1"; }

##############################################################################
echo ""
echo "=================================================="
echo "  Design Token Compliance Checker"
echo "  $(date '+%Y-%m-%d %H:%M')"
echo "=================================================="
echo ""

# ── Pre-flight ──────────────────────────────────────
if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: $MANIFEST not found"; exit 2
fi
for f in "$NEXTJS" "$SVELTE"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: Required reference file not found: $f"; exit 2
  fi
done
if [[ ! -f "$SKILL_MD" ]]; then
  echo "ERROR: SKILL.md not found at $SKILL_MD"; exit 2
fi
echo "Files loaded:"
echo "  Manifest:  $MANIFEST"
echo "  Next.js:   $NEXTJS"
echo "  Svelte:    $SVELTE"
echo "  SKILL.md:  $SKILL_MD"
echo ""

###############################################################################
# HELPER: check that BOTH files contain a needle string
both_contain() {
  local label="$1" needle="$2"
  local n_count s_count
  n_count=$(grep -cF "$needle" "$NEXTJS" 2>/dev/null || true)
  s_count=$(grep -cF "$needle" "$SVELTE" 2>/dev/null || true)
  if [[ "$n_count" -gt 0 && "$s_count" -gt 0 ]]; then
    ok "$label ('$needle' present in both)"
  else
    fail "$label — needle '$needle' missing (next:$n_count, svelte:$s_count)"
  fi
}

###############################################################################
# HELPERS for numeric token checks
# grep -P enables perl regex; look for digit patterns
has_value() {
  # $1=file $2=regex_pattern
  grep -qP "$2" "$1" 2>/dev/null
}

check_numeric_match() {
  # check_numeric_match LABEL NEIGHBORHOOD PATTERN EXPECTED
  local label="$1" neigh="$2" pat="$3" exp="$4"
  local n_found="" s_found=""
  n_found=$(grep -oP "$pat" "$NEXTJS" 2>/dev/null | head -1 || true)
  s_found=$(grep -oP "$pat" "$SVELTE" 2>/dev/null | head -1 || true)
  local n_val="${n_found#$neigh}"
  local s_val="${s_found#$neigh}"
  n_val=$(echo "$n_val" | tr -d '[:space:]')
  s_val=$(echo "$s_val" | tr -d '[:space:]')

  if [[ -z "$n_found" ]] && [[ -z "$s_found" ]]; then
    fail "$label — neither file mentions $neigh"
  elif [[ -z "$n_found" ]]; then
    fail "$label — NEXT.js missing $neigh (found in Svelte: $s_val)"
  elif [[ -z "$s_found" ]]; then
    fail "$label — Svelte missing $neigh (found in Next.js: $n_val)"
  elif [[ "$n_val" == "$s_val" ]]; then
    ok "$label — both use $n_val"
  else
    fail "$label — Next.js=$n_val  vs  Svelte=$s_val  (expected=$exp)"
  fi
}

###############################################################################
# PHASE A: SOP 6 checklist items
echo "--- Glow Card Checks ---"
check_numeric_match "Glow circle radius" "circle" "(?<=(circle\s*))\d+(?=px)" "150px"
check_numeric_match "Glow transition duration" "[^ ]*(ms|s)" "(?<=(transition[^{]*?)[ :\-])([0-9.]+)(ms|s)" "0.3s"

# Check border-radius
has_both_rounded_2xl="circle 150px"  # if this appears in BOTH, we assume rounded-2xl was also fixed
if has_value "$NEXTJS" "rounded-2xl" && has_value "$SVELTE" "rounded-2xl"; then
  ok "Glow card radius: BOTH use rounded-2xl"
else
  fail "Glow card radius mismatch"
fi

echo ""
echo "--- Theme Dropdown Checks ---"
both_contain "Dropdown entrance (slide-in-from-top-2)" "slide-in-from-top-2"
both_contain "Dropdown entrance (fade-in)" "fade-in"
both_contain "Dropdown entrance (duration-150)" "duration-150"
both_contain "Dropdown width (w-48)" "w-48"

echo ""
echo "--- Hero Banner Checks ---"
both_contain "Hero height (h-[85vh])" "h-\[85vh\]"
both_contain "Ken Burns zoom (scale-105)" "scale-105"
both_contain "Ken Burns animation" "zoom-in_40s_infinite_linear"
both_contain "Image opacity (opacity-60)" "opacity-60"

# Content entrance check (Next.js uses initial={{ opacity: 0, y: 20 }})
both_contain "Content entrance (y: 20)" "y: 20"
both_contain "Content entrance (600ms)" "600"

# Overlay gradient check
both_contain "Overlay gradient (from-zinc-950/80)" "from-zinc-950/80"

echo ""
echo "--- Dark Mode Checks ---"
n_dark_count=$(grep -ciP 'dark:bg|dark:text|dark:border' "$NEXTJS" 2>/dev/null || true)
s_dark_count=$(grep -ciP 'dark:bg|dark:text|dark:border' "$SVELTE" 2>/dev/null || true)
if [[ "$n_dark_count" -eq 0 && "$s_dark_count" -eq 0 ]]; then
  ok "Dark mode prevention: no dark:* utilities in either framework"
else
  warn "Dark mode utility classes found — next:$n_dark_count, svelte:$s_dark_count"
fi

###############################################################################
# PHASE B: SKILL.md compliance verification
echo ""
echo "--- SKILL.md SOP 6 Presence Check ---"
if grep -qF "SOP 6:" "$SKILL_MD" 2>/dev/null; then
  ok "SOP 6 present in SKILL.md"
else
  fail "SOP 6 missing from SKILL.md"
fi

if grep -qF "design-token-manifest.md" "$SKILL_MD" 2>/dev/null; then
  ok "Manifest reference exists in SKILL.md"
else
  fail "Manifest not referenced in SKILL.md"
fi

###############################################################################
# SUMMARY
echo ""
echo "=================================================="
printf "  Results:  ✅ %d  ❌ %d  ⚠️  %d\n" "$PASS" "$FAIL" "$WARN"
echo "=================================================="

if [[ "$FAIL" -gt 0 ]]; then
  echo "  STATUS: DIVERGENCE DETECTED"
  echo ""
  echo "  Run ./scripts/auto-fix-divergences.sh to auto-patch."
  exit 1
fi
echo "  STATUS: ALL CHECKS PASS"
exit 0
