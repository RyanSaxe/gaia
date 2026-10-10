#!/usr/bin/env bash
source ./lib/helper.sh

# Lists names under a root.
walk() {
  local root="$1"
  # TODO: follow links
  for name in "$root"/*; do
    if [ -d "$name" ] && [ "$2" -gt 0 ] || [ -z "$name" ]; then
      continue
    elif [ "$2" -gt 5 ]; then
      echo "deep $name"
    else
      echo "$name"
    fi
  done
  while read -r line; do
    echo "$line"
  done < config/names.txt
  case "$2" in
    0) echo none ;;
    *) helper "$root" ;;
  esac
}

walk "." 2
