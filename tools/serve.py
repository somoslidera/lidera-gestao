#!/usr/bin/env python3
"""Serve o Flow no navegador, em http://localhost:4179.

    python3 tools/serve.py              # serve o PREVIEW (_site/), sem banco. Rode antes o preview_build.py
    python3 tools/serve.py --porta 8080
    python3 tools/serve.py --producao   # serve a raiz do repo como está: FALA COM O BANCO DE PRODUÇÃO

Atenção: o --producao abre o mesmo app que está no ar, com login de verdade. Tudo o
que você gravar vai para os restaurantes reais. Para testar mudança, use o padrão
(preview) ou abra com ?demo=1 o restaurante de demonstração.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--porta", type=int, default=4179)
    ap.add_argument("--producao", action="store_true", help="serve a raiz do repo (banco de PRODUÇÃO)")
    ap.add_argument("--pasta", default="_site", help="pasta do preview (padrão: _site)")
    args = ap.parse_args()

    pasta = RAIZ if args.producao else RAIZ / args.pasta
    if not (pasta / "index.html").exists():
        sys.exit(f"serve: não achei {pasta / 'index.html'}. Rode antes: python3 tools/preview_build.py")
    if args.producao:
        print("serve: ATENÇÃO, este modo usa o banco de PRODUÇÃO.", file=sys.stderr)

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(pasta))
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.porta), handler) as srv:
        print(f"serve: http://localhost:{args.porta}/  ({'PRODUÇÃO' if args.producao else 'preview, sem banco'})  Ctrl+C para parar")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
