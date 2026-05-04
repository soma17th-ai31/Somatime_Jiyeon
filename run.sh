#!/usr/bin/env bash
# =============================================================
# SomaMeet 로컬 실행 스크립트
#  1) backend/.venv 가상환경 생성 (없으면)
#  2) requirements.txt 설치
#  3) uvicorn 으로 FastAPI 실행 (프론트엔드 정적 파일도 함께 서빙)
# 기본 포트: 8000
# 사용:
#   ./run.sh
#   브라우저에서 http://localhost:8000 접속
# =============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend"

if [ ! -d ".venv" ]; then
  echo "[1/3] 가상환경 생성..."
  python3 -m venv .venv
fi

# shellcheck source=/dev/null
source .venv/bin/activate

echo "[2/3] 의존성 설치..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo "[3/3] 서버 시작 — http://localhost:8000"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
