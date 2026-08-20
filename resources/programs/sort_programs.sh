#!/usr/bin/env python3

import os
import json

SCHEMA_ORDER = ["id", "title", "description", "readonly", "series"]
PROGRAMS_DIR = os.path.dirname(__file__)

def sort_and_fix_program(data):
    # Ensure all required top-level properties exist
    for key in SCHEMA_ORDER:
        if key not in data:
            if key == "readonly":
                data[key] = False
            elif key == "series":
                data[key] = []
            else:
                data[key] = ""
    # Sort properties
    sorted_data = {k: data[k] for k in SCHEMA_ORDER}
    return sorted_data

def main():
    for fname in os.listdir(PROGRAMS_DIR):
        if fname.endswith(".json"):
            fpath = os.path.join(PROGRAMS_DIR, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            fixed = sort_and_fix_program(data)
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump(fixed, f, indent=2, ensure_ascii=False)
            print(f"Updated {fname}")

if __name__ == "__main__":
    main()