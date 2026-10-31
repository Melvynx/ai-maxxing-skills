#!/usr/bin/env bash
# Install, list, update and remove skills for Claude Code and Codex.
# Everywhere (default): ~/.agents/skills/<name> (Codex reads it there), linked in ~/.claude/skills.
# One folder only (--to <folder>, the brain or a project): <folder>/.agents/skills/<name>, read by Claude Code
# through <folder>/.claude/skills. Each skill installed here keeps where it came from in <skill>/.source,
# so update fetches it again. Removed skills are moved to ~/.cache/removed-skills, never deleted.
#
#   skills.sh available [<source>]                          what a source offers (default: the ai-maxxing kit)
#   skills.sh install <source> [<skill>...|all] [--to <folder>] [--force]
#   skills.sh list [--to <folder>]
#   skills.sh update [<skill>...] [--to <folder>]
#   skills.sh remove <skill>... [--to <folder>]
#
# <source>: skill names of the kit (create-landing lumail), a GitHub repo (owner/repo), a GitHub link to a repo,
# a folder or a SKILL.md (https://github.com/owner/repo/tree/main/skills/x), or a local folder.
# Exit codes: 2 usage or a repo with several skills and none named, 3 a skill with that name exists and was not
# installed by this script (rerun with --force only to replace it), 4 not found.
set -u

KIT=Melvynx/ai-maxxing-skills
TRASH="$HOME/.cache/removed-skills"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cmd="${1:-}"; [ $# -gt 0 ] && shift
TO="" FORCE=0 ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TO="${2:?--to needs a folder}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}

if [ -n "$TO" ]; then
  ROOT="$(cd "$TO" 2>/dev/null && pwd)" || { echo "not a folder: $TO" >&2; exit 4; }
  DEST="$ROOT/.agents/skills" CLAUDE="$ROOT/.claude/skills"
else
  DEST="$HOME/.agents/skills" CLAUDE="$HOME/.claude/skills"
fi

skill_name() { local n; n="$(sed -n 's/^name: *//p' "$1/SKILL.md" | head -1 | tr -d "\"'")"; echo "${n:-$(basename "$1")}"; }
describe() { sed -n 's/^description: *//p' "$1/SKILL.md" | head -1 | tr -d '"' | cut -c1-110; }
same_dir() { [ "$(cd "$1" 2>/dev/null && pwd -P)" = "$(cd "$2" 2>/dev/null && pwd -P)" ]; }

# Makes Claude Code see DEST/<name>: nothing when CLAUDE already is (a link to) DEST, one link to the whole
# folder for a brain or project that has none yet, otherwise one link per skill.
link() {
  same_dir "$CLAUDE" "$DEST" && return
  if [ -n "$TO" ] && [ ! -e "$CLAUDE" ] && [ ! -L "$CLAUDE" ]; then
    mkdir -p "$ROOT/.claude" && ln -s ../.agents/skills "$CLAUDE"
  elif [ -n "$TO" ]; then
    ln -sfn "../../.agents/skills/$1" "$CLAUDE/$1"
  else
    mkdir -p "$CLAUDE" && ln -sfn "$DEST/$1" "$CLAUDE/$1"
  fi
}
unlink_claude() { [ -L "$CLAUDE/$1" ] && ! [ -e "$CLAUDE/$1" ] && rm -f "$CLAUDE/$1"; return 0; }
stash() { mkdir -p "$TRASH" && mv "$DEST/$1" "$TRASH/$1-$(date +%Y%m%d-%H%M%S)"; }

# Downloads a source into $TMP and sets BASE (the folder to search), and for GitHub REPO, REF and TOP (the repo root).
fetch() {
  local s="${1%/}" path="" out
  REPO="" REF=HEAD TOP=""
  if [ -d "$s" ]; then BASE="$(cd "$s" && pwd)"; return; fi
  s="${s#https://}"; s="${s#http://}"; s="${s#github.com/}"; s="${s%.git}"
  case "$s" in
    */*/tree/*|*/*/blob/*) REPO="$(echo "$s" | cut -d/ -f1-2)"; REF="$(echo "$s" | cut -d/ -f4)"; path="$(echo "$s" | cut -d/ -f5-)" ;;
    */*) REPO="$(echo "$s" | cut -d/ -f1-2)"; path="$(echo "$s" | cut -d/ -f3-)" ;;
    *) echo "not a source: $1" >&2; return 4 ;;
  esac
  path="${path%/SKILL.md}"
  out="$TMP/$(echo "$REPO@$REF" | tr '/' '_')"
  if [ ! -d "$out" ]; then
    mkdir -p "$out"
    if ! curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" 2>/dev/null | tar -xz -C "$out" 2>/dev/null; then
      # a private repo: through the user's GitHub login
      command -v gh >/dev/null && gh api "repos/$REPO/tarball/$REF" 2>/dev/null | tar -xz -C "$out" 2>/dev/null \
        || { rm -rf "$out"; echo "cannot download $REPO ($REF): check the link, or run setup-github for a private repo" >&2; return 4; }
    fi
  fi
  TOP="$(find "$out" -mindepth 1 -maxdepth 1 -type d | head -1)"
  BASE="$TOP${path:+/$path}"
  [ -d "$BASE" ] || { echo "not found: $path in $REPO" >&2; return 4; }
}

# The skill folders under BASE, one per line, without the skills nested inside another skill.
skills_in() {
  local d k kept=()
  while IFS= read -r d; do
    for k in ${kept[@]+"${kept[@]}"}; do case "$d/" in "$k"/*) continue 2 ;; esac; done
    kept+=("$d")
    echo "$d"
  done < <(find "$BASE" -name SKILL.md -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | sed 's|/SKILL.md$||' | sort)
}

# Where an installed skill came from, as a source install accepts.
origin() {
  if [ -n "$REPO" ]; then echo "https://github.com/$REPO/tree/$REF/${1#"$TOP"/}"; else (cd "$1" && pwd); fi
}

put() { # <skill folder>
  local src="$1" name; name="$(skill_name "$1")"
  if [ -e "$DEST/$name" ] || [ -L "$DEST/$name" ]; then
    if [ ! -f "$DEST/$name/.source" ] && [ "$FORCE" != 1 ]; then
      echo "exists=$name (the user's own or installed another way: $(describe "$DEST/$name" 2>/dev/null))" >&2; return 3
    fi
    # a copy installed from a source is fetched again, so only the user's own skill is kept aside
    if [ -f "$DEST/$name/.source" ]; then rm -rf "${DEST:?}/$name"; else stash "$name"; fi
  fi
  mkdir -p "$DEST" && cp -R "$src" "$DEST/$name" && rm -rf "$DEST/$name/.git" && origin "$src" > "$DEST/$name/.source" \
    && link "$name" && echo "installed=$name -> $DEST/$name"
}

install() {
  [ $# -gt 0 ] || { echo "usage: skills.sh install <source> [<skill>...|all] [--to <folder>]" >&2; return 2; }
  local src="$1" want=() all found d n status=0 hit
  shift
  if [ ! -d "$src" ] && [[ "$src" != */* ]]; then want=("$src" "$@"); src="$KIT"; else want=("$@"); fi
  fetch "$src" || return
  found="$(skills_in)"
  [ -n "$found" ] || { echo "no SKILL.md in $src" >&2; return 4; }
  if [ ${#want[@]} -eq 0 ]; then
    if [ "$(echo "$found" | wc -l)" -gt 1 ]; then
      echo "several skills in $src, name the ones to install (or all):" >&2
      while IFS= read -r d; do printf '  %-22s %s\n' "$(skill_name "$d")" "$(describe "$d")" >&2; done <<< "$found"
      return 2
    fi
    want=(all)
  fi
  for n in "${want[@]}"; do
    hit=0
    while IFS= read -r d; do
      if [ "$n" = all ] || [ "$(skill_name "$d")" = "$n" ] || [ "$(basename "$d")" = "$n" ]; then
        hit=1; put "$d" || status=$?
      fi
    done <<< "$found"
    [ "$hit" = 1 ] || { echo "unknown=$n (not in $src)" >&2; status=4; }
  done
  return $status
}

case "$cmd" in
  available)
    fetch "${1:-$KIT}" || exit
    while IFS= read -r d; do
      n="$(skill_name "$d")"
      if [ -f "$DEST/$n/.source" ]; then state=installed; elif [ -e "$DEST/$n" ]; then state=own; else state=available; fi
      printf '%-22s %-10s %s\n' "$n" "$state" "$(describe "$d")"
    done < <(skills_in)
    ;;
  install) install "$@" ;;
  list)
    for d in "$DEST"/*/; do
      [ -f "$d/SKILL.md" ] || continue
      d="${d%/}"
      if [ -f "$d/.source" ]; then from="$(sed 's|https://github.com/||; s|/tree/.*||' "$d/.source")"; else from=own; fi
      printf '%-22s %-28s %s\n' "$(basename "$d")" "$from" "$(describe "$d")"
    done
    # skills Claude Code sees that are not in the shared folder (Codex does not see them)
    same_dir "$CLAUDE" "$DEST" || for d in "$CLAUDE"/*/; do
      [ -f "$d/SKILL.md" ] && ! [ -L "${d%/}" ] && printf '%-22s %-28s %s\n' "$(basename "$d")" "claude-only" "$(describe "${d%/}")"
    done
    exit 0
    ;;
  update)
    names=("$@")
    if [ ${#names[@]} -eq 0 ]; then
      for d in "$DEST"/*/; do [ -f "$d/.source" ] && names+=("$(basename "$d")"); done
    fi
    [ ${#names[@]} -gt 0 ] || { echo "nothing installed by skill-manager in $DEST"; exit 0; }
    status=0 FORCE=1
    for n in "${names[@]}"; do
      [ -f "$DEST/$n/.source" ] || { echo "skipped=$n (not installed by skill-manager)" >&2; continue; }
      install "$(cat "$DEST/$n/.source")" || status=$?
    done
    exit $status
    ;;
  remove)
    [ $# -gt 0 ] || { echo "usage: skills.sh remove <skill>... [--to <folder>]" >&2; exit 2; }
    status=0
    for n in "$@"; do
      if [ -e "$DEST/$n" ] || [ -L "$DEST/$n" ]; then
        stash "$n" && unlink_claude "$n" && echo "removed=$n (kept in $TRASH)"
      elif [ -L "$CLAUDE/$n" ] || [ -d "$CLAUDE/$n" ]; then
        mkdir -p "$TRASH" && mv "$CLAUDE/$n" "$TRASH/$n-$(date +%Y%m%d-%H%M%S)" && echo "removed=$n (kept in $TRASH)"
      else
        echo "missing=$n" >&2; status=4
      fi
    done
    exit $status
    ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
