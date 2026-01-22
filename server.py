#!/usr/bin/env python3
import http.server
import socketserver
from pathlib import Path

PORT = 8000
DIRECTORY = "/workspace"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

def main():
    print(f"Serving GLB viewer at http://localhost:{PORT}")
    print("Press Ctrl+C to stop the server")
    
    # Check if test.glb exists
    glb_path = Path(DIRECTORY) / "test.glb"
    if not glb_path.exists():
        print(f"Warning: {glb_path} does not exist!")
    else:
        print(f"Found GLB file: {glb_path}")
    
    # Check if index.html exists
    html_path = Path(DIRECTORY) / "index.html"
    if not html_path.exists():
        print(f"Warning: {html_path} does not exist!")
    else:
        print(f"Found HTML file: {html_path}")
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main()