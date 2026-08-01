"""Auto-download CloakBrowser anti-detect browser.

Downloads to resources/cloakbrowser/ so the backend bundles it into the app installer.
"""
import os
import platform
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

_RELEASE = "chromium-v146.0.7680.177.4"

CLOAKBROWSER_URLS = {
    "Windows": (
        "https://github.com/CloakHQ/CloakBrowser/releases/download/"
        f"{_RELEASE}/cloakbrowser-windows-x64.zip"
    ),
    "Linux": (
        "https://github.com/CloakHQ/CloakBrowser/releases/download/"
        f"{_RELEASE}/cloakbrowser-linux-x64.tar.gz"
    ),
}


def get_project_root() -> Path:
    script_dir = Path(__file__).resolve().parent
    # From python/autoreg/browser/ to project root
    return script_dir.parent.parent.parent


def download_cloakbrowser(resources_dir: Path | None = None) -> Path:
    system = platform.system()
    url = CLOAKBROWSER_URLS.get(system)
    if not url:
        print(f"Auto-download not supported on {system}. Please install CloakBrowser manually.")
        sys.exit(1)

    project_root = get_project_root()
    if resources_dir is None:
        resources_dir = project_root / "resources" / "cloakbrowser"

    chrome_binary = resources_dir / ("chrome.exe" if system == "Windows" else "chrome")
    archive_name = "cloakbrowser.zip" if system == "Windows" else "cloakbrowser.tar.gz"
    archive_path = resources_dir / archive_name

    if chrome_binary.exists():
        print(f"CloakBrowser already present: {chrome_binary}")
        return chrome_binary

    resources_dir.mkdir(parents=True, exist_ok=True)
    print(f"Downloading CloakBrowser for {system} from GitHub...")
    print(f"URL: {url}")

    try:
        urllib.request.urlretrieve(url, archive_path)
        print(f"Downloaded: {archive_path.stat().st_size / 1024 / 1024:.1f} MB")
    except Exception as e:
        print(f"Download failed: {e}")
        sys.exit(1)

    print("Extracting...")
    if system == "Windows":
        with zipfile.ZipFile(archive_path, 'r') as zf:
            zf.extractall(resources_dir)
    else:
        with tarfile.open(archive_path, 'r:gz') as tf:
            tf.extractall(resources_dir)

    archive_path.unlink()

    if not chrome_binary.exists():
        print(f"ERROR: Expected binary not found after extraction: {chrome_binary}")
        sys.exit(1)

    if system != "Windows":
        os.chmod(chrome_binary, 0o755)

    print(f"CloakBrowser ready: {chrome_binary}")
    return chrome_binary


if __name__ == "__main__":
    download_cloakbrowser()
