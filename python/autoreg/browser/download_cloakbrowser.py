"""Auto-download CloakBrowser anti-detect browser."""
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

CLOAKBROWSER_URL = (
    "https://github.com/CloakHQ/CloakBrowser/releases/download/"
    "chromium-v146.0.7680.177.4/cloakbrowser-windows-x64.zip"
)


def get_project_root() -> Path:
    script_dir = Path(__file__).resolve().parent
    # From python/autoreg/browser/ to project root
    return script_dir.parent.parent.parent


def download_cloakbrowser() -> Path:
    project_root = get_project_root()
    bin_dir = project_root / "bin" / "cloakbrowser"
    zip_path = bin_dir / "cloakbrowser.zip"
    chrome_exe = bin_dir / "chrome.exe"

    if chrome_exe.exists():
        print(f"CloakBrowser already present: {chrome_exe}")
        return chrome_exe

    bin_dir.mkdir(parents=True, exist_ok=True)
    print(f"Downloading CloakBrowser from GitHub... (~540 MB)")
    print(f"URL: {CLOAKBROWSER_URL}")

    try:
        urllib.request.urlretrieve(CLOAKBROWSER_URL, zip_path)
        print(f"Downloaded: {zip_path.stat().st_size / 1024 / 1024:.1f} MB")
    except Exception as e:
        print(f"Download failed: {e}")
        sys.exit(1)

    print("Extracting...")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(bin_dir)

    zip_path.unlink()
    print(f"CloakBrowser ready: {chrome_exe}")
    return chrome_exe


if __name__ == "__main__":
    download_cloakbrowser()
