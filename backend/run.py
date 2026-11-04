"""Start the app: python backend/run.py [--port 8001]"""
import argparse
import sys
from pathlib import Path
import uvicorn
sys.path.insert(0, str(Path(__file__).resolve().parent))
import threading
from housing.server import create_app
from housing import analysis

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8001)
args = parser.parse_args()
# Build the linear model, the 150 random markets for W_T and the default Monte Carlo draws in the background.
threading.Thread(target=lambda: (analysis.overview(), analysis._draws(0.2, 100, 5)), daemon=True).start()
uvicorn.run(create_app(), host="127.0.0.1", port=args.port)
