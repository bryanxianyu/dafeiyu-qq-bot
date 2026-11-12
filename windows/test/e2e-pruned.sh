#!/usr/bin/env bash
# 用精简后的 DSH 跑端到端：bash windows/test/e2e-pruned.sh
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
export DSH_HOME=$ROOT/.build-cache/home-probe
rm -rf $DSH_HOME/profiles/fish/node_modules/dsh-fish; mkdir -p $DSH_HOME/profiles/fish/node_modules/dsh-fish; cp -r $ROOT/plugin/. $DSH_HOME/profiles/fish/node_modules/dsh-fish/
cd $ROOT/.build-cache/probe-data
node $ROOT/test/mock-onebot.mjs 3901 > mock.log 2>&1 & MOCK=$!
sleep 1
node $ROOT/.build-cache/pruned/node_modules/@deepseek-ai/dsh/lib/bin.js --profile fish > fish.log 2> fish.err &
for i in $(seq 1 150); do sleep 2; kill -0 $MOCK 2>/dev/null || break; done
pwsh -NoProfile -File "$ROOT/windows/test/kill.ps1"; sleep 1
echo "==== MOCK"; cat mock.log; echo "==== ERR"; head -12 fish.err
