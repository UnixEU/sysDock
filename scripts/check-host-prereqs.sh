#!/usr/bin/env sh

set -eu

echo "Checking sysDock host prerequisites..."

if ! command -v sysctl >/dev/null 2>&1; then
  echo "WARN: 'sysctl' is not available on this host, so vm.overcommit_memory could not be verified."
  exit 0
fi

kernel_name="$(uname -s 2>/dev/null || echo unknown)"

if [ "${kernel_name}" != "Linux" ]; then
  echo "INFO: Skipping vm.overcommit_memory check on ${kernel_name}."
  exit 0
fi

overcommit_value="$(sysctl -n vm.overcommit_memory 2>/dev/null || true)"

if [ -z "${overcommit_value}" ]; then
  echo "WARN: Unable to read vm.overcommit_memory."
  exit 0
fi

if [ "${overcommit_value}" != "1" ]; then
  echo "ERROR: vm.overcommit_memory=${overcommit_value}"
  echo "Redis may fail background save or replication when this is not set to 1."
  echo "Fix on the host with:"
  echo "  sudo sysctl vm.overcommit_memory=1"
  echo "To persist across reboots:"
  echo "  echo 'vm.overcommit_memory = 1' | sudo tee /etc/sysctl.d/99-sysdock.conf"
  echo "  sudo sysctl --system"
  exit 1
fi

echo "OK: vm.overcommit_memory=1"
