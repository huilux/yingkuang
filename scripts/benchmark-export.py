#!/usr/bin/env python3
"""Measure the actual Rust export path without including Cargo compilation.

Build once with `cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run`
and pass the printed test executable. Use --release when building release tests.
The real-photo fixture is local and is never downloaded or committed here.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from datetime import datetime, timezone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--binary", type=Path, required=True)
parser.add_argument("--label", required=True)
parser.add_argument("--input", type=Path)
parser.add_argument("--repeats", type=int, default=3)
parser.add_argument("--matrix", action="store_true", help="all built-in templates, JPEG/PNG, 1200px/original")
parser.add_argument("--template", default="wide-float")
parser.add_argument("--format", choices=["jpeg", "png"], default="jpeg")
parser.add_argument("--original", action="store_true")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
binary = args.binary.resolve(strict=True)
source = (args.input or repo / "assets/origin/PANA9432.JPG").resolve(strict=True)
if args.repeats < 1:
    parser.error("--repeats must be positive")

def seconds(value, unit):
    return float(value) * {"s": 1, "ms": 0.001, "µs": 0.000001, "ns": 0.000000001}[unit]

catalog = json.loads((repo / "src/data/builtin-templates.json").read_text())
templates = [item["id"] for item in catalog["templates"]] if args.matrix else [args.template]
formats = ["jpeg", "png"] if args.matrix else [args.format]
sizes = [False, True] if args.matrix else [args.original]
report = {
    "label": args.label,
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "binary": str(binary),
    "input": str(source),
    "runs": [],
}
args.output.parent.mkdir(parents=True, exist_ok=True)
for template in templates:
    for format_name in formats:
        for original in sizes:
            for repeat in range(args.repeats):
                env = {key: value for key, value in os.environ.items() if not key.startswith("YINGKUANG_BENCH_")}
                env.update(YINGKUANG_BENCH_INPUT=str(source), YINGKUANG_BENCH_TEMPLATE=template,
                           YINGKUANG_BENCH_FORMAT=format_name)
                if original:
                    env["YINGKUANG_BENCH_ORIGINAL"] = "1"
                with tempfile.NamedTemporaryFile() as metrics:
                    result = subprocess.run([
                        "/usr/bin/time", "-f", "%e %M", "-o", metrics.name, str(binary),
                        "export_latency_budget", "--ignored", "--nocapture",
                    ], cwd=repo / "src-tauri", env=env, capture_output=True, text=True)
                    timing = Path(metrics.name).read_text().strip().splitlines()[-1].split()
                log = result.stdout + result.stderr
                match = re.search(r"total: ([\d.]+)(ms|µs|ns|s)", log)
                stages = {name: seconds(value, unit) for name, value, unit in re.findall(
                    r"export benchmark (\w+): ([\d.]+)(ms|µs|ns|s)", log)}
                output = re.search(r"output: (\d+)x(\d+); bytes: (\d+)", log)
                run = {
                    "template": template, "format": format_name,
                    "size": "original" if original else "1200", "repeat": repeat + 1,
                    "exportSeconds": seconds(*match.groups()) if match else None,
                    "wallSeconds": float(timing[0]), "maxRssKiB": int(timing[1]),
                    "stages": stages, "exitCode": result.returncode,
                }
                if output:
                    run.update(zip(["width", "height", "outputBytes"], map(int, output.groups())))
                if result.returncode:
                    run["error"] = log
                report["runs"].append(run)
                args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
                print(json.dumps({key: value for key, value in run.items() if key != "error"}, ensure_ascii=False), flush=True)
                if not match:
                    raise SystemExit("Export did not complete; see saved report")
