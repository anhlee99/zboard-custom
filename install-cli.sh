#!/usr/bin/env bash
# Put the "zboard" command on your PATH: a symlink to cli/zboard.js in the first writable
# folder of PATH (Windows folders under /mnt are skipped), else ~/.local/bin.
set -e
src="$(cd "$(dirname "$0")" && pwd)/cli/zboard.js"
chmod +x "$src"
IFS=: read -r -a dirs <<<"$PATH"
for d in "$HOME/.local/bin" "$HOME/bin" "${dirs[@]}"; do
  case "$d" in /mnt/*|"") continue ;; esac
  case ":$PATH:" in *":$d:"*) ;; *) continue ;; esac
  if [ -d "$d" ] && [ -w "$d" ]; then
    ln -sf "$src" "$d/zboard"
    echo "Installed $d/zboard -> $src"
    exit 0
  fi
done
mkdir -p "$HOME/.local/bin"
ln -sf "$src" "$HOME/.local/bin/zboard"
echo "Installed $HOME/.local/bin/zboard -> $src"
echo "Add ~/.local/bin to your PATH (e.g. in ~/.bashrc: export PATH=\"\$HOME/.local/bin:\$PATH\")."
