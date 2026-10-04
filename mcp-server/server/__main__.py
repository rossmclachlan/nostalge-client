"""`python -m server [serve|login|healthcheck]`"""

from __future__ import annotations

import argparse
import logging
import sys


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m server")
    parser.add_argument("command", nargs="?", default="serve", choices=["serve", "login", "healthcheck"])
    args = parser.parse_args()

    if args.command == "healthcheck":  # used by the Docker HEALTHCHECK
        import os
        import urllib.request

        urllib.request.urlopen(f"http://127.0.0.1:{os.environ.get('PORT', '8000')}/healthz", timeout=3)
        return

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # Third-party loggers can print request URLs and headers at DEBUG; keep them quiet.
    for noisy in ("tidalapi", "httpx", "httpcore", "urllib3", "requests"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    from .config import ConfigError, load_settings

    try:
        if args.command == "login":
            from .tidal import interactive_login

            settings = load_settings(require_oauth=False)
            interactive_login(settings.tidal_session_file)
            return

        import uvicorn

        from .app import create_app

        settings = load_settings()
        app = create_app(settings)
        uvicorn.run(app, host=settings.host, port=settings.port, access_log=False, proxy_headers=True,
                    forwarded_allow_ips="*")
    except ConfigError as e:
        sys.exit(f"Config error: {e}")


if __name__ == "__main__":
    main()
