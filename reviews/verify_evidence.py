#!/usr/bin/env python3
"""Read-only SHA256 check of the review packet's selected baseline evidence."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys


def verify(root, manifest_path):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "otter/review-evidence/v1":
        raise ValueError("unsupported evidence manifest schema")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("manifest must list evidence files")
    seen = set()
    failures = []
    for entry in files:
        if not isinstance(entry, dict):
            raise ValueError("invalid evidence entry")
        name, expected = entry.get("path"), entry.get("sha256")
        if not isinstance(name, str) or not name:
            raise ValueError("invalid evidence path")
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or str(path) != name or "\\" in name:
            raise ValueError("evidence paths must be normalized repository-relative paths")
        if name in seen:
            raise ValueError("duplicate evidence path: " + name)
        seen.add(name)
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise ValueError("invalid SHA256 for " + name)
        resolved = (root / name).resolve()
        if root not in resolved.parents:
            raise ValueError("evidence path escapes root: " + name)
        if not resolved.is_file():
            failures.append("MISSING " + name)
        elif hashlib.sha256(resolved.read_bytes()).hexdigest() != expected:
            failures.append("CHANGED " + name)
    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1
    print("Verified {} evidence files against baseline {}.".format(
        len(files), manifest.get("baselineCommit", "unspecified")))
    print("Content identity only; no signature, proof, test run or safety certification.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--manifest", type=Path,
                        default=Path(__file__).resolve().with_name("EVIDENCE_MANIFEST.json"))
    args = parser.parse_args()
    try:
        return verify(args.root.resolve(), args.manifest.resolve())
    except (OSError, ValueError, TypeError, AttributeError) as error:
        print("Evidence verification failed: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
