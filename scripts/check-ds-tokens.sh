#!/usr/bin/env bash
#
# check-ds-tokens.sh — web-design-standards compliance checker
# (Chat-Agents skills/web-design-standards, plan 0084 D1, issue #3247).
#
# A site repo copies (or vendors) this script and wires it into its own CI
# during standards adoption (plan 0084 D9–D12). It never runs fleet-wide:
# repos that haven't adopted are "not yet measurable," never failed.
#
# Usage:
#   check-ds-tokens.sh [--token-file <path>]... <css-file-or-dir>...
#
#   --token-file  file(s) allowed to define raw color values (the token set
#                 itself). Every other scanned file must be literal-free.
#
# Checks (each violation printed as "file:line: message"; exit 1 on any):
#   1. custom properties defined outside --ds-* namespace, unless inside a
#      /* ds-alias-allow-begin */ ... /* ds-alias-allow-end */ block
#   2. raw color literals (#hex, rgb(), hsl()) outside token files / alias blocks
#   3. media-query breakpoints other than the canonical 640/1024/1440
#   4. token files missing the mandatory prefers-reduced-motion reduce block
#
# Exit codes: 0 clean · 1 violations · 2 usage/setup error.

set -euo pipefail

TOKEN_FILES=()
TARGETS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --token-file) shift; [ $# -gt 0 ] || { echo "check-ds-tokens: --token-file needs a path" >&2; exit 2; }; TOKEN_FILES+=("$1");;
    -h|--help) sed -n '2,26p' "$0"; exit 0;;
    *) TARGETS+=("$1");;
  esac
  shift
done

[ ${#TARGETS[@]} -gt 0 ] || { echo "check-ds-tokens: no CSS files or directories given" >&2; exit 2; }

# Expand directories to .css files
FILES=()
for t in "${TARGETS[@]}"; do
  if [ -d "$t" ]; then
    while IFS= read -r -d '' f; do FILES+=("$f"); done < <(find "$t" -name '*.css' -type f -print0)
  elif [ -f "$t" ]; then
    FILES+=("$t")
  else
    echo "check-ds-tokens: no such file or directory: $t" >&2; exit 2
  fi
done
[ ${#FILES[@]} -gt 0 ] || { echo "check-ds-tokens: no .css files found under targets" >&2; exit 2; }

is_token_file() {
  local f="$1" tf
  for tf in "${TOKEN_FILES[@]:-}"; do
    [ -n "$tf" ] && [ "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")" = "$(cd "$(dirname "$tf")" && pwd)/$(basename "$tf")" ] && return 0
  done
  return 1
}

violations=0
report() { echo "$1:$2: $3"; violations=$((violations + 1)); }

check_breakpoints() { # $1=file $2=lineno $3=media-query prelude text
  local bp v
  bp=$(printf '%s\n' "$3" | grep -oE '(min|max)-width:[[:space:]]*[0-9.]+(px|em|rem)' | grep -oE '[0-9.]+(px|em|rem)' || true)
  for v in $bp; do
    case "$v" in
      640px|1024px|1440px|40em|64em|90em|40rem|64rem|90rem) ;;
      *) report "$1" "$2" "non-canonical breakpoint $v (standard: 640/1024/1440 mobile-first min-width)";;
    esac
  done
}

for f in "${FILES[@]}"; do
  in_alias=0
  in_comment=0
  media_buf=""
  media_line=0
  lineno=0
  token_file=0
  is_token_file "$f" && token_file=1
  has_reduce_block=0
  grep -q 'prefers-reduced-motion:[[:space:]]*reduce' "$f" && has_reduce_block=1

  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))

    # alias markers — a one-liner carrying BOTH markers skips itself only
    case "$line" in
      *"ds-alias-allow-begin"*"ds-alias-allow-end"*) continue;;
      *"ds-alias-allow-begin"*) in_alias=1; continue;;
      *"ds-alias-allow-end"*) in_alias=0; continue;;
    esac
    [ "$in_alias" = 1 ] && continue

    # block-comment state: drop commented-out text before any scanning
    if [ "$in_comment" = 1 ]; then
      case "$line" in
        *"*/"*) line="${line#*\*/}"; in_comment=0;;
        *) continue;;
      esac
    fi
    # strip complete inline /* ... */ comments, then an unterminated opener
    line=$(printf '%s\n' "$line" | sed -E 's@/\*([^*]|\*+[^*/])*\*+/@@g')
    case "$line" in
      *"/*"*) line="${line%%/\**}"; in_comment=1;;
    esac
    [ -n "$line" ] || continue

    # 1. non---ds-* custom property definitions (a definition is `--name:`;
    #    usage inside var(--name) has no trailing colon, so it never matches)
    if printf '%s\n' "$line" | grep -oE '\-\-[A-Za-z][A-Za-z0-9_-]*[[:space:]]*:' \
       | grep -qvE '^--ds-'; then
      report "$f" "$lineno" "custom property outside --ds-* namespace (alias it inside a ds-alias-allow block or migrate it)"
    fi

    # 2. raw color literals outside token files — scrub url(...) fragments and
    #    quoted string literals first so url(#id) / content:"#abc" don't trip it
    if [ "$token_file" = 0 ]; then
      scrub=$(printf '%s\n' "$line" | sed -E "s|url\([^)]*\)||g; s|\"[^\"]*\"||g; s|'[^']*'||g")
      if printf '%s\n' "$scrub" | grep -qE '#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\('; then
        report "$f" "$lineno" "raw color literal outside a token file (use a --ds-* token)"
      fi
    fi

    # 3. non-canonical breakpoints — buffer the @media prelude across lines
    #    until its opening brace, then check the whole condition
    if [ -n "$media_buf" ]; then
      media_buf="$media_buf $line"
    else
      case "$line" in
        *"@media"*) media_buf="$line"; media_line=$lineno;;
      esac
    fi
    if [ -n "$media_buf" ]; then
      case "$media_buf" in
        *"{"*)
          check_breakpoints "$f" "$media_line" "${media_buf%%\{*}"
          media_buf=""
          ;;
      esac
    fi
  done < "$f"

  # unterminated @media prelude at EOF still gets checked
  [ -n "$media_buf" ] && check_breakpoints "$f" "$media_line" "$media_buf"

  # 4. token files must carry the reduce block
  if [ "$token_file" = 1 ] && [ "$has_reduce_block" = 0 ]; then
    report "$f" 1 "token file is missing the mandatory prefers-reduced-motion reduce block"
  fi
done

if [ "$violations" -gt 0 ]; then
  echo "check-ds-tokens: $violations violation(s) across ${#FILES[@]} file(s)" >&2
  exit 1
fi
echo "check-ds-tokens: clean — ${#FILES[@]} file(s) conform to web-design-standards"
