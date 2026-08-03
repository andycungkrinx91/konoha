#!/usr/bin/env bash
#
# auto-fix-divergences.sh
# Patch Svelte and Next.js references so they match the Design Token Manifest.
# Run from the skill root directory (jonin-skill/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REF="$SCRIPT_DIR/../references"
NEXTJS="$REF/nextjs-ui-expert.md"
SVELTE="$REF/svelte-ui-expert.md"
SKILL_MD="$SCRIPT_DIR/../SKILL.md"

CHANGES=0

fix_file() {
  # $1=file $2=old $3=new
  if grep -qF "$2" "$1" 2>/dev/null; then
    sed -i "s|$2|$3|g" "$1"
    CHANGES=$((CHANGES+1))
    echo "  Fixed in $(basename "$1"): '$2' → '$3'"
  fi
}

echo "Auto-patching divergences..."

# Glow card circle radius: change 400px/600px → 150px
for f in "$NEXTJS" "$SVELTE"; do
  fix_file "$f" "radial-gradient(" "radial-gradient(circle 150px"
done

# Glow card transition duration: 0.4s → 0.3s
for f in "$NEXTJS" "$SVELTE"; do
  fix_file "$f" "0.4s ease" "0.3s ease"
  fix_file "$f" "0\.4s ease" "0.3s ease"
done

# Glow card border radius: rounded-xl → rounded-2xl
for f in "$NEXTJS" "$SVELTE"; do
  fix_file "$f" "rounded-xl" "rounded-2xl"
done

# Glow card bg: white/75 → white/70
for f in "$NEXTJS" "$SVELTE"; do
  fix_file "$f" "bg-white/75" "bg-white/70"
done

# Dropdown entrance animation
for f in "$NEXTJS" "$SVELTE"; do
  fix_file "$f" "transition-all duration-300" "animate-in fade-in slide-in-from-top-2 duration-150"
done

# Hero banner Ken Burns animation on Next.js images
fix_file "$NEXTJS" 'className="w-full h-full object-cover opacity-60 scale-105"' \
         'className="w-full h-full object-cover opacity-60 scale-105 animate-[zoom-in_40s_infinite_linear]"'

# Dark mode cleanup — remove dark: prefixes
for f in "$NEXTJS" "$SVELTE"; do
  # Only remove simple cases like dark:bg-zinc-950 → bg-zinc-950
  sed -i -E 's/dark:(bg-[a-zA-Z0-9\/#%]+)//g' "$f"
  sed -i -E 's/dark:(text-[a-zA-Z0-9\/#%]+)//g' "$f"
  sed -i -E 's/dark:(border-[a-zA-Z0-9\/#%]+)//g' "$f"
done

echo ""
echo "Auto-fix complete. $CHANGES files modified."
echo ""

# Now re-run compliance check
echo "Running compliance check..."
bash "$SCRIPT_DIR/verify-token-compliance.sh"
