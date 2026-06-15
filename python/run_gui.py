import webview
import threading
import uvicorn
import sys
import os
import time
import requests
import argparse

# Add the current directory to sys.path to find the app module
sys.path.append(os.path.dirname(__file__))

from app.main import app

def start_server(port):
    # Run FastAPI server on a local port
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")

def wait_for_server(url, timeout=15):
    """Wait for the server to be ready before opening the webview."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            response = requests.get(f"{url}/health")
            if response.status_code == 200:
                return True
        except requests.ConnectionError:
            pass
        time.sleep(0.5)
    return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Stitch Account Manager GUI')
    parser.add_argument('--dev', action='store_true', help='Run in development mode (connects to Vite server)')
    args = parser.parse_args()

    api_port = 8420
    
    # 1. Start FastAPI in a background thread
    server_thread = threading.Thread(target=start_server, args=(api_port,), daemon=True)
    server_thread.start()

    # 2. Define the URL
    # In dev mode, we point to the Vite dev server (port 5174)
    # In prod mode, we point to the FastAPI server which serves static files
    if args.dev:
        url = "http://localhost:5174"
        print(f"Starting in DEV mode, connecting to {url}")
    else:
        url = f"http://127.0.0.1:{api_port}"
        print(f"Starting in PROD mode, connecting to {url}")
    
    # Wait for API server to start
    api_url = f"http://127.0.0.1:{api_port}"
    if wait_for_server(api_url):
        # 3. Create and start the webview window
        window = webview.create_window(
            'Stitch Account Manager',
            url,
            width=1280,
            height=800,
            min_size=(1024, 768),
            background_color='#000000'
        )
        # Enable debug mode for dev
        webview.start(debug=args.dev)
    else:
        print("Error: FastAPI server failed to start.")
        sys.exit(1)
