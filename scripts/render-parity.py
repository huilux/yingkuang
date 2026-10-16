#!/usr/bin/env python3
"""Compare real Rust rendering with WebKit SVG pixels; requires Vite on port 1422."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="yingkuang-parity-") as directory:
    root = Path(directory)
    subprocess.run(["cargo", "test", "--manifest-path", str(repo / "src-tauri/Cargo.toml"),
                    "preview_parity_fixtures", "--", "--ignored"], cwd=repo, check=True,
                   env={**os.environ, "YINGKUANG_PARITY_DIR": directory})
    fixtures = {path.stem: "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()
                for path in root.glob("*.png")}
    source = (repo / "scripts/render-parity-regression.js").read_text()
    check = root / "check.js"
    check.write_text(source.replace("__FIXTURES__", json.dumps(fixtures)))
    subprocess.run(["xvfb-run", "-a", sys.executable, str(repo / "scripts/run-webkit-regressions.py"),
                    sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1422", str(check)], cwd=repo, check=True)
