from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension"
DIST = ROOT / "dist"
OUTPUT = DIST / "thunderbird-ai-bridge.xpi"


def main() -> None:
    if not (SOURCE / "manifest.json").exists():
        raise SystemExit("extension/manifest.json not found")

    DIST.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()

    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(SOURCE.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(SOURCE).as_posix())

    print(f"Built: {OUTPUT}")


if __name__ == "__main__":
    main()
