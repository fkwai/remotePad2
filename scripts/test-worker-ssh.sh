#!/usr/bin/env bash
set -euo pipefail

archive="$PWD/apps/worker/dist/worker-binaries.tar.gz"
root=$(mktemp -d /tmp/rp2-ssh-test.XXXXXXXX)
export REMOTEPAD2_WORKER_ARCHIVE="$root/worker-binaries.tar.gz"
# Make each test worker revision unique, including when reusing a CI runner.
tar -xzf "$archive" -C "$root"
touch "$root/fixture-$RANDOM-$RANDOM"
(cd "$root" && tar -czf "$REMOTEPAD2_WORKER_ARCHIVE" worker-linux-* fixture-*)
revision=$(sha256sum "$REMOTEPAD2_WORKER_ARCHIVE" | cut -c1-20)
socketdir="/tmp/rp2-$(id -u)-dev-$revision"
cleanup() {
  if [[ -x "$root/server-home/.remotepad2/backend/dev/$revision/worker" ]]; then
    pkill -TERM -f "^$root/server-home/.remotepad2/backend/dev/$revision/worker$" || true
  fi
  if [[ -f "$root/sshd.pid" ]]; then
    sudo kill "$(cat "$root/sshd.pid")" 2>/dev/null || true
  fi
  rm -rf -- "$root" "$socketdir"
}
trap cleanup EXIT

mkdir -p "$root/client-home" "$root/server-home" "$root/bin" "$root/client-bin"
for tool in uname id mkdir mktemp chmod mv tar gzip nohup sleep cat rm getent stat; do
  ln -s "$(command -v "$tool")" "$root/bin/$tool"
done
ssh-keygen -q -t ed25519 -N '' -f "$root/id_ed25519"
ssh-keygen -q -t ed25519 -N '' -f "$root/host_key"
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
printf '[127.0.0.1]:%s %s\n' "$port" "$(cut -d' ' -f1,2 "$root/host_key.pub")" > "$root/known_hosts"
cat > "$root/client-config" <<EOF
Host rp2-go-test
  HostName 127.0.0.1
  Port $port
  User $(id -un)
  BatchMode yes
  IdentityFile $root/id_ed25519
  IdentitiesOnly yes
  UserKnownHostsFile $root/known_hosts
  StrictHostKeyChecking yes
EOF
cat > "$root/client-bin/ssh" <<EOF
#!/bin/sh
exec /usr/bin/ssh -F "$root/client-config" "\$@"
EOF
chmod 700 "$root/client-bin/ssh"
cat > "$root/force-command" <<EOF
#!/bin/sh
export HOME="$root/server-home"
export CODEX_HOME="$root/server-home/.codex"
export PATH="$root/bin"
exec /bin/sh -c "\$SSH_ORIGINAL_COMMAND"
EOF
chmod 700 "$root/force-command"
cat > "$root/sshd-config" <<EOF
Port $port
ListenAddress 127.0.0.1
HostKey $root/host_key
PidFile $root/sshd.pid
AuthorizedKeysFile $root/id_ed25519.pub
StrictModes no
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
AllowUsers $(id -un)
AllowTcpForwarding no
AllowStreamLocalForwarding yes
ForceCommand $root/force-command
EOF

sudo mkdir -p /run/sshd
sudo /usr/sbin/sshd -f "$root/sshd-config" -E "$root/sshd.log"
export REMOTEPAD2_TEST_SERVER_HOME="$root/server-home"
export REMOTEPAD2_TEST_CLIENT_BIN="$root/client-bin"
export REMOTEPAD2_CHANNEL=dev
unset REMOTEPAD2_REMOTE_WORKER
HOME="$root/client-home" PATH="$root/client-bin:$PATH" apps/server/node_modules/.bin/tsx --test tests/worker-ssh.integration.ts ||
  { sudo cat "$root/sshd.log"; exit 1; }
