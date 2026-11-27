#!/usr/bin/env python3
"""Monta a versão de PREVIEW do Flow, que nunca fala com o banco de produção.

Uso:
    python3 tools/preview_build.py            # gera a pasta _site/
    python3 tools/preview_build.py --out dist

O que faz:
  1. Copia o site (index.html, pdv/, versao.json) para a pasta de saída.
     Não copia CNAME (o preview não pode reivindicar flow.somoslidera.com.br),
     supabase/, tools/ nem .github/.
  2. No index.html, troca a URL do Supabase por vazio. Sem URL o app não cria o
     cliente do Supabase (`sb = null`) e roda no "modo local": os dados ficam só
     no navegador de quem abriu o preview.
  3. No PDV, força a demonstração (`DEMO = true`).
  4. Troca qualquer outra menção ao host de produção por um host inválido.
  5. Injeta uma faixa "PREVIEW · sem banco", `noindex` e, na primeira visita,
     carrega um restaurante de demonstração.
  5b. Injeta o painel "Simular" (tools/preview_simulacao.js): troca o perfil de quem
     está logado e monta cenários de dados, só no navegador. O perfil roda o MESMO
     trecho do login de membro do index.html, copiado daqui na hora do build.
  6. Confere no fim: se ainda sobrar alguma menção ao projeto de produção, o
     build FALHA. Na dúvida, não sai preview.

Só usa a biblioteca padrão do Python 3.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PROJETO_PROD = "fvcbxorfstqqeewocxkf"
HOST_PROD = f"https://{PROJETO_PROD}.supabase.co"
HOST_FALSO = "https://preview-sem-banco.invalid"

COPIAR = ["index.html", "pdv", "versao.json"]

FAIXA = """
<!-- preview_build.py: faixa e demonstração do preview -->
<style>#flowPreviewFaixa{position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#b45309;color:#fff;font:600 12px/1.2 system-ui,sans-serif;text-align:center;padding:5px 8px;pointer-events:none;opacity:.92}</style>
<div id="flowPreviewFaixa">PREVIEW · sem banco: nada do que você fizer aqui vai para o Flow de verdade</div>
<script>
(function(){
  /* Primeira visita ao preview: troca a base vazia por um restaurante de demonstração.
     Para começar de uma base vazia, abra com ?vazio=1. */
  try{
    if(typeof sb!=='undefined'&&sb){document.getElementById('flowPreviewFaixa').textContent='ERRO: preview conectado ao banco. Feche esta aba.';return;}
    if(location.search.indexOf('vazio=1')>=0)return;
    var marca='flow_preview_demo_v1';
    if(localStorage.getItem(marca))return;
    if(typeof buildDemoDados!=='function'||typeof DEMO_SPECS==='undefined'||!DEMO_SPECS.length)return;
    DB=buildDemoDados(DEMO_SPECS[0]);
    save();
    localStorage.setItem(marca,'1');
    try{go('dashboard');}catch(e){location.reload();}
  }catch(e){console.warn('[preview] demo não carregou',e);}
})();
</script>
"""


def falhar(msg: str) -> None:
    print(f"preview_build: ERRO: {msg}", file=sys.stderr)
    sys.exit(1)


def trocar_uma_vez(texto: str, padrao: str, novo: str, onde: str) -> str:
    novo_texto, n = re.subn(padrao, novo, texto, count=0)
    if n != 1:
        falhar(f"{onde}: esperava 1 ocorrência de {padrao!r}, achei {n}. "
               "O código mudou: ajuste o preview_build.py antes de publicar.")
    return novo_texto


SIMULACAO = Path(__file__).resolve().parent / "preview_simulacao.js"
MARCA_TRECHO = "/*@@TRECHO_LOGIN@@*/"
TRECHO_INICIO = "MEMBRO_PERMS=null;MEMBRO_SUB=null;MEMBRO_SETORES=null;MEMBRO_NOME='';MEMBRO_NIVEL='';"
TRECHO_FIM_LINHA = "if(MEMBRO_PERMS){aplicarAcessoMembro();go(MEMBRO_PERMS[0]);}"


def trecho_login(s: str) -> str:
    """Copia, do login de membro (entrarComoCliente), o trecho que decide dono × membro e
    liga MEMBRO_PERMS/SUB/SETORES/NIVEL, mais a linha que aplica o acesso. O painel "Simular"
    roda exatamente esse código. Se o login mudar de forma que o trecho não seja achado, o
    build falha (não sai preview com uma simulação diferente do login real)."""
    onde = "index.html (login de membro)"
    i = s.find("async function entrarComoCliente(")
    if i < 0 or s.count("async function entrarComoCliente(") != 1:
        falhar(f"{onde}: não achei entrarComoCliente. O código mudou: ajuste o preview_build.py.")
    fim = s.find("\n}\n", i)
    corpo = s[i:fim]
    m = re.search(re.escape(TRECHO_INICIO) + r".*?\n  \}\n", corpo, re.S)
    if not m or corpo.count(TRECHO_INICIO) != 1 or corpo.count(TRECHO_FIM_LINHA) != 1:
        falhar(f"{onde}: o trecho do login de membro mudou. Ajuste o preview_build.py.")
    a = m.group(0)
    for obrig in ("naEquipe", "normMembro(naEquipe)", "MEMBRO_SUB=", "MEMBRO_SETORES=", "MEMBRO_NIVEL="):
        if obrig not in a:
            falhar(f"{onde}: o trecho copiado não tem {obrig!r}. Ajuste o preview_build.py.")
    if "await" in a or "</script" in a:
        falhar(f"{onde}: o trecho do login passou a ter await ou </script>. Ajuste o preview_build.py.")
    return a + "  " + TRECHO_FIM_LINHA


def painel_simulacao(s: str) -> str:
    js = SIMULACAO.read_text(encoding="utf-8")
    if js.count(MARCA_TRECHO) != 1:
        falhar("preview_simulacao.js: falta a marca do trecho do login")
    js = js.replace(MARCA_TRECHO, "/* --- início: copiado de entrarComoCliente (index.html) --- */\n"
                    + trecho_login(s) + "\n    /* --- fim do trecho copiado --- */")
    return "\n<!-- preview_build.py: painel Simular (só no preview) -->\n<script>\n" + js + "\n</script>\n"


def montar_index(caminho: Path) -> None:
    s = caminho.read_text(encoding="utf-8")
    painel = painel_simulacao(s)
    s = trocar_uma_vez(s, r"const SUPA_URL='https://" + PROJETO_PROD + r"\.supabase\.co'",
                       "const SUPA_URL='' /* preview: sem banco */", "index.html")
    s = s.replace(HOST_PROD, HOST_FALSO)
    s = trocar_uma_vez(s, r"<head>", '<head>\n<meta name="robots" content="noindex,nofollow">', "index.html")
    s = trocar_uma_vez(s, r"</body>", lambda _m: FAIXA + painel + "</body>", "index.html")
    caminho.write_text(s, encoding="utf-8")


def montar_pdv(caminho: Path) -> None:
    s = caminho.read_text(encoding="utf-8")
    s = trocar_uma_vez(s, r"DEMO=QS\.has\('demo'\)\|\|", "DEMO=true||", "pdv/index.html")
    s = s.replace(HOST_PROD, HOST_FALSO)
    s = trocar_uma_vez(s, r"<head>", '<head>\n<meta name="robots" content="noindex,nofollow">', "pdv/index.html")
    caminho.write_text(s, encoding="utf-8")


def conferir(saida: Path) -> None:
    sobras = []
    for f in saida.rglob("*"):
        if f.is_file() and f.suffix in {".html", ".js", ".json", ".css", ""}:
            if PROJETO_PROD in f.read_text(encoding="utf-8", errors="ignore"):
                sobras.append(str(f.relative_to(saida)))
    if sobras:
        falhar("ainda há menção ao banco de produção em: " + ", ".join(sobras))
    if (saida / "CNAME").exists():
        falhar("CNAME foi copiado para o preview")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="_site", help="pasta de saída (padrão: _site)")
    args = ap.parse_args()
    saida = (RAIZ / args.out).resolve()
    if saida == RAIZ or RAIZ not in saida.parents:
        falhar("a pasta de saída precisa ficar dentro do repositório e não pode ser a raiz")
    if saida.exists():
        shutil.rmtree(saida)
    saida.mkdir(parents=True)
    for nome in COPIAR:
        origem = RAIZ / nome
        if origem.is_dir():
            shutil.copytree(origem, saida / nome)
        elif origem.exists():
            shutil.copy2(origem, saida / nome)
    montar_index(saida / "index.html")
    if (saida / "pdv" / "index.html").exists():
        montar_pdv(saida / "pdv" / "index.html")
    (saida / "_headers").write_text("/*\n  X-Robots-Tag: noindex, nofollow\n", encoding="utf-8")
    conferir(saida)
    print(f"preview_build: ok → {saida.relative_to(RAIZ)}/ (sem banco de produção)")


if __name__ == "__main__":
    main()
