#!/usr/bin/env bash
set -euo pipefail
# Isolated CI-only SSH fixture: ephemeral keys, loopback listener, no global sshd config.
ROOT=$(pwd)
TEMP_AGENT=$(mktemp -d)
cleanup() {
  if [ -f "$TEMP_AGENT/sshd.pid" ]; then sudo kill "$(cat "$TEMP_AGENT/sshd.pid")" || true; fi
  rm -rf -- "$TEMP_AGENT"
}
trap cleanup EXIT
ssh-keygen -q -t ed25519 -N '' -f "$TEMP_AGENT/host"
ssh-keygen -q -t ed25519 -N '' -f "$TEMP_AGENT/client"
cp "$TEMP_AGENT/client.pub" "$TEMP_AGENT/authorized_keys"
printf '[127.0.0.1]:22222 %s\n' "$(cat "$TEMP_AGENT/host.pub")" > "$TEMP_AGENT/known_hosts"
cat > "$TEMP_AGENT/sshd_config" <<EOF
Port 22222
ListenAddress 127.0.0.1
HostKey $TEMP_AGENT/host
PidFile $TEMP_AGENT/sshd.pid
AuthorizedKeysFile $TEMP_AGENT/authorized_keys
StrictModes no
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
AllowUsers $(id -un)
EOF
printf '#!/bin/sh\nexec "%s" "%s/bin/openmili.js" "$@"\n' "$(command -v node)" "$ROOT" > "$TEMP_AGENT/agent"
chmod 755 "$TEMP_AGENT/agent"
sudo mkdir -p /run/sshd
sudo /usr/sbin/sshd -f "$TEMP_AGENT/sshd_config" -E "$TEMP_AGENT/sshd.log"
node bin/openmili.js agent --ssh "$(id -un)@127.0.0.1" --ssh-port 22222 --ssh-key "$TEMP_AGENT/client" --known-hosts "$TEMP_AGENT/known_hosts" --remote-path "$TEMP_AGENT/agent" --task doctor --offline --redact --json --output "$TEMP_AGENT/result.json" > "$TEMP_AGENT/stdout.json"
node -e 'const fs=require("fs"),r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.mode!=="agent"||r.agent.host_verification!=="StrictHostKeyChecking=yes"||r.doctor.offline!==true)process.exit(1);console.log("REAL SSH Agent: authenticated loopback execution and schema-valid report PASS")' "$TEMP_AGENT/stdout.json"
