"""Configuration + secrets loading.

`config/config.yaml` holds non-secret runtime settings; `.env` holds API credentials.
Secrets are never read from the YAML.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config" / "config.yaml"
DATA_DIR = PROJECT_ROOT / "data"
CASES_DIR = DATA_DIR / "cases"
STATE_DIR = DATA_DIR / "state"


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Load YAML runtime config and load .env into the environment."""
    load_dotenv(PROJECT_ROOT / ".env")
    cfg_path = Path(path) if path else DEFAULT_CONFIG_PATH
    if not cfg_path.exists():
        raise FileNotFoundError(f"Config file not found: {cfg_path}")
    with cfg_path.open("r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    _ensure_dirs()
    return cfg


def _ensure_dirs() -> None:
    for d in (DATA_DIR, CASES_DIR, STATE_DIR):
        d.mkdir(parents=True, exist_ok=True)


def env(name: str, required: bool = False, default: str | None = None) -> str | None:
    """Read an environment variable, optionally requiring it."""
    val = os.environ.get(name, default)
    if required and not val:
        raise RuntimeError(
            f"Required environment variable '{name}' is not set. "
            f"Add it to your .env file (see .env.example)."
        )
    return val
