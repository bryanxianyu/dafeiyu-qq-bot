#!/usr/bin/env bash
# 端到端测试：重装插件 -> 起假 QQ -> 起大肥鱼 -> 看回复
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DSH="node $USERPROFILE/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js"
rm -rf "$USERPROFILE/.dsh/profiles/fish/node_modules/dsh-fish"; mkdir -p "$USERPROFILE/.dsh/profiles/fish/node_modules/dsh-fish"; cp -r "$ROOT/plugin/." "$USERPROFILE/.dsh/profiles/fish/node_modules/dsh-fish/"
mkdir -p "$ROOT/.testdata"; cd "$ROOT/.testdata"
node ../test/mock-onebot.mjs 3901 > ../test/mock.log 2>&1 & MOCK=$!
sleep 1
$DSH --profile fish > ../test/fish.log 2>&1 & FISH=$!
for i in $(seq 1 150); do sleep 2; kill -0 $MOCK 2>/dev/null || break; done
pwsh -NoProfile -File "$ROOT/windows/test/kill.ps1"; sleep 1
echo "==== MOCK"; cat ../test/mock.log; echo "==== FISH"; tail -40 ../test/fish.log
