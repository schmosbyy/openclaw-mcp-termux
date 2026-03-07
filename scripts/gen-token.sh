#!/data/data/com.termux/files/usr/bin/bash
# Generate a secure 32-byte hex token for BRIDGE_TOKEN
# Requires: pkg install openssl-tool
echo "Your BRIDGE_TOKEN:"
openssl rand -hex 32
