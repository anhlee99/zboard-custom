# ZBoard: working notes for Claude

## Where things run

ZBoard lives in **WSL Ubuntu** (`~/zboard`, user `zlud`), even when you are driven from Windows
(the repo is then seen as `\\wsl.localhost\ubuntu\home\zlud\zboard`).

- **Commands you give the user** are for the **WSL (Ubuntu) terminal**: plain bash run inside WSL,
  starting from `cd ~/zboard`. Not PowerShell, not cmd, not Git Bash.
- **Windows programs from WSL** (e.g. Tailscale, which is installed on Windows only) are called by their
  full path: `"/mnt/c/Program Files/Tailscale/tailscale.exe" serve --bg 3000`.
- **Commands you run yourself** go through WSL too: `wsl -d ubuntu -- bash -l /home/zlud/<script>.sh`
  (write a small script for anything with `$`, `|` or quotes; delete it afterwards). Node comes from nvm,
  so use a login shell (`bash -l`) or source `~/.nvm/nvm.sh`.
- **git and gh** only inside WSL. If `gh` there isn't logged in, ask the user to run `gh auth login` in WSL.
- Real server: `~/.local/bin/zb-start` (port 3000). Test server: `~/.local/bin/zb-test-server` (port 3200).
- The Chrome extension is loaded unpacked from `C:\Users\PC\Desktop\zboard-clipper`; copy `extension/`
  there after changing it, then reload it in `chrome://extensions`.
