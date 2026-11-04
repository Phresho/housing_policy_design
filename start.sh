#!/bin/zsh
# Starts the app at http://127.0.0.1:8001
cd "$(dirname "$0")" && exec /opt/anaconda3/envs/housing/bin/python backend/run.py --port 8001
