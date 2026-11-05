#!/usr/bin/env python3
"""
aplicar_sync.py — Aplica la sincronización manual/automática a los HTML del repo.

Uso (desde cualquier carpeta):
    python3 herramientas/aplicar_sync.py RUTA_DEL_REPO [--dry-run]

Qué hace, por archivo:
  - Busca cada punto de edición (ancla) y exige que exista EXACTAMENTE una vez.
  - Si cualquier ancla falla, NO escribe ese archivo y lo reporta (todo o nada por archivo).
  - Antes de escribir crea <archivo>.bak. Es idempotente: si el archivo ya trae isa-sync.js, lo salta.
  - Copia isa-sync.js a la raíz del repo.
"""
import re, sys, shutil
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ_PAQUETE = AQUI.parent
V = "?v=1"                                   # sube el número si cambias isa-sync.js (caché de GitHub Pages)
TAG = f'<script src="isa-sync.js{V}"></script>\n'


class Fallo(Exception):
    pass


def una_vez(txt, patron, repl, etiqueta, flags=0, literal=False):
    """Sustituye exactamente una coincidencia; si hay 0 o >1, falla."""
    rx = re.compile(re.escape(patron) if literal else patron, flags)
    n = len(rx.findall(txt))
    if n != 1:
        raise Fallo(f"{etiqueta}: se esperaba 1 coincidencia y hay {n}")
    return rx.sub(lambda m: repl(m) if callable(repl) else (repl if literal else m.expand(repl)), txt, count=1)


def tag_antes_de(txt, marca, etiqueta):
    """Inserta <script src=isa-sync.js> justo antes del <script> inline que contiene `marca`."""
    i = txt.find(marca)
    if i < 0 or txt.count(marca) != 1:
        raise Fallo(f"{etiqueta}: no encuentro (una vez) «{marca}» para ubicar el script principal")
    j = txt.rfind("<script", 0, i)
    if j < 0:
        raise Fallo(f"{etiqueta}: no hay <script> antes de «{marca}»")
    return txt[:j] + TAG + txt[j:]


# ───────────────────────── seguimiento_cosecha.html ─────────────────────────
def parche_seguimiento(t):
    t = tag_antes_de(t, "var COL='planificador_compartido'", "seguimiento/script")
    t = una_vez(t, "recargar:function(){if(fbDb&&S.user)leerDesdeFirestore();else render();}",
                "recargar:function(){if(fbDb&&S.user)return leerDesdeFirestore();render();}",
                "seguimiento/recargar", literal=True)
    t = una_vez(t, r"(async function leerDesdeFirestore\(\)\{\s*)if\(_leyendo\)return;_leyendo=true;",
                r"\1if(_leyendo)return false;_leyendo=true;", "seguimiento/guarda _leyendo")
    t = una_vez(t, r"clearTimeout\(lento\);_leyendo=false;(\s*)if\(!hayDB\)S\.zafra='';(\s*)render\(\);(\s*)\}",
                lambda m: ("clearTimeout(lento);_leyendo=false;" + m.group(1) + "if(!hayDB)S.zafra='';" + m.group(2) +
                           "render();" + m.group(2) + "try{ISASync.marcar('seguimiento',S.srcOk);}catch(e){}" + m.group(2) +
                           "return S.srcOk;" + m.group(3) + "}"),
                "seguimiento/cierre leerDesdeFirestore")
    t = una_vez(t, "SGP.mount(document.getElementById('sgp-root'));",
                "SGP.mount(document.getElementById('sgp-root'));\n"
                "if(typeof ISASync!=='undefined'){\n"
                "  ISASync.registrar({id:'seguimiento',nombre:'Seguimiento de cosecha',\n"
                "    permitido:function(){return !!SGP.api.state.user;},\n"
                "    ejecutar:function(){return SGP.api.recargar();}});\n"
                "  ISASync.montarChip('seguimiento');\n}",
                "seguimiento/registro", literal=True)
    return t


# ───────────────────────── diseno_lotes.html ─────────────────────────
NUEVA_LEER_DE_BASE = """async function leerDeBase() {
  if (typeof ISA === 'undefined' || leyendoBase) return false;
  leyendoBase = true; $('b-isa-leer').disabled = true;
  var zPrev = $('p-zafra').value, ok = false;
  try {
    aceptarPlan(await ISA.leerPlan(function(t) { mensaje('e-plan', t); }), 'Base del planificador');
    estado.planOrigen = 'base';
    // aceptarPlan reinicia el selector de zafra: se conserva la elección del usuario si sigue existiendo
    if (zPrev && Array.from($('p-zafra').options).some(function(o) { return o.value === zPrev; })) $('p-zafra').value = zPrev;
    ok = (await leerRegistroDeBase()) !== false;
  }
  catch (e) { mensaje('e-plan', 'No se pudo leer la base: ' + e.message + ' También puedes usar el archivo .json.', 'error'); }
  finally { leyendoBase = false; $('b-isa-leer').disabled = false; }
  try { ISASync.marcar('diseno', ok); } catch (e) {}
  return ok;
}
/* Sincronización manual/automática (configurada en index → Ajustes). No toca datos cargados desde archivo .json. */
if (typeof ISASync !== 'undefined') {
  ISASync.registrar({ id: 'diseno', nombre: 'Diseño de lotes',
    permitido: function() { var s = ISA.sesion && ISA.sesion(); return !!(s && s.user && s.listo && s.rol) && estado.planOrigen === 'base'; },
    ocupado: function() { return leyendoBase || leyendoReg; },
    ejecutar: leerDeBase });
  ISASync.montarChip('diseno');
}"""


def parche_diseno(t):
    t = tag_antes_de(t, "async function leerDeBase()", "diseno/script")
    # leerRegistroDeBase devuelve true/false
    t = una_vez(t, r"(refrescarMaquinas\(true\);)(\s*\} catch \(e\) \{ mensaje\('e-regbase', 'No se pudo leer el registro de la base: )",
                r"\1\n    return true;\2", "diseno/return true")
    t = una_vez(t, r"(También puedes cargar los CSV del Sheet\.', 'error'\);) \}(\s*finally \{ leyendoReg = false;)",
                r"\1 return false; }\2", "diseno/return false")
    t = una_vez(t, r"async function leerDeBase\(\)\s*\{.*?\n\}", lambda m: NUEVA_LEER_DE_BASE,
                "diseno/leerDeBase", flags=re.S)
    return t


# ───────────────────────── resumen_cosechadoras.html ─────────────────────────
def parche_resumen(t):
    t = tag_antes_de(t, "async function leerBase()", "resumen/script")
    t = una_vez(t, r'(\n)(\s*)\} catch \(e\) \{ stBase\("No se pudo leer el registro de la base: " \+ e\.message, "bad"\); \}(\s*finally \{ leyendoBase = false; \})',
                lambda m: (m.group(1) + m.group(2) + '  try { ISASync.marcar("resumen", true); } catch (e2) {}\n' +
                           m.group(2) + '  return true;\n' + m.group(2) +
                           '} catch (e) { try { ISASync.marcar("resumen", false); } catch (e2) {} '
                           'stBase("No se pudo leer el registro de la base: " + e.message, "bad"); return false; }' + m.group(3)),
                "resumen/leerBase cierre")
    t = una_vez(t, '$("b-isa-leer").addEventListener("click", leerBase);',
                '$("b-isa-leer").addEventListener("click", leerBase);\n'
                '    if (typeof ISASync !== "undefined") {   // sincronización manual/automática (index → Ajustes)\n'
                '      ISASync.registrar({ id: "resumen", nombre: "Resumen de cosechadoras",\n'
                '        permitido: function () { var s = ISA.sesion && ISA.sesion(); return !!(s && s.user && s.listo && s.rol); },\n'
                '        ocupado: function () { return leyendoBase || guardandoBase || corriendo; },\n'
                '        ejecutar: async function () {   // si las versiones de «meta» no cambiaron, basta 1 lectura en vez de releer todo\n'
                '          try {\n'
                '            var meta = await ISA.registro.meta(), zs = Object.keys(meta.zafras || {}), vb = Object.keys(versionBase);\n'
                '            if (zs.length && zs.length === vb.length && zs.every(function (z) { return versionBase[z] === meta.zafras[z].version; })) return true;\n'
                '          } catch (e) { /* si la comprobación falla, se hace la lectura completa */ }\n'
                '          return leerBase();\n'
                '        } });\n'
                '      ISASync.montarChip("resumen");\n    }',
                "resumen/registro", literal=True)
    return t


# ───────────────────────── index.html ─────────────────────────
def parche_index(t):
    src = (AQUI / "ajustes-sync-index.html").read_text(encoding="utf-8")
    i = src.find('<div class="card" id="card-sync">')
    j = src.find("<script>", i)          # después de la tarjeta (el comentario de cabecera también nombra <script>)
    k = src.find("</script>", j)
    if min(i, j, k) < 0:
        raise Fallo("index: ajustes-sync-index.html no tiene el formato esperado")
    tarjeta, js = src[i:j].rstrip() + "\n", src[j:k + len("</script>")]
    # tarjeta dentro de #page-ajustes, después del título si existe
    rz = re.compile(r'(id="config-zafra-default-status"[^>]*></span>\s*</div>\s*</div>)')
    if len(rz.findall(t)) == 1:          # preferido: justo después de la tarjeta «Zafra por defecto»
        t = rz.sub(lambda m: m.group(1) + "\n\n      " + tarjeta, t, count=1)
    else:                                 # alternativa: debajo del título de la página
        rx = re.compile(r'(<div id="page-ajustes"[^>]*>\s*(?:<div class="page-title">.*?</div>)?)', re.S)
        if len(rx.findall(t)) != 1:
            raise Fallo("index: no encuentro (una vez) <div id=\"page-ajustes\">")
        t = rx.sub(lambda m: m.group(1) + "\n" + tarjeta, t, count=1)
    # llamada desde syncAjustesPage()
    t = una_vez(t, r"(function syncAjustesPage\(\)\s*\{)",
                r"\1\n  if (typeof syncAjustesSyncCard === 'function') syncAjustesSyncCard();", "index/syncAjustesPage")
    # script + JS de la tarjeta antes de </body>
    if t.count("</body>") != 1:
        raise Fallo("index: no encuentro (una vez) </body>")
    return t.replace("</body>", TAG + js + "\n</body>", 1)


ARCHIVOS = [
    ("index.html", parche_index),
    ("seguimiento_cosecha.html", parche_seguimiento),
    ("diseno_lotes.html", parche_diseno),
    ("resumen_cosechadoras.html", parche_resumen),
]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    seco = "--dry-run" in sys.argv
    if not args:
        sys.exit(__doc__)
    repo = Path(args[0]).resolve()
    if not repo.is_dir():
        sys.exit(f"No existe la carpeta: {repo}")
    ok = fallos = 0
    for nombre, fn in ARCHIVOS:
        ruta = repo / nombre
        if not ruta.exists():
            print(f"[--] {nombre}: no está en el repo, se omite"); continue
        txt = ruta.read_text(encoding="utf-8")
        if "isa-sync.js" in txt:
            print(f"[=]  {nombre}: ya tiene isa-sync.js, se omite"); continue
        try:
            nuevo = fn(txt)
        except Fallo as e:
            fallos += 1; print(f"[!!] {nombre}: NO modificado → {e}"); continue
        if not seco:
            shutil.copy2(ruta, ruta.with_suffix(ruta.suffix + ".bak"))
            ruta.write_text(nuevo, encoding="utf-8", newline="")
        ok += 1; print(f"[OK] {nombre}: {'(simulado) ' if seco else ''}parchado")
    if not seco:
        shutil.copy2(RAIZ_PAQUETE / "isa-sync.js", repo / "isa-sync.js")
        print("[OK] isa-sync.js copiado a la raíz del repo")
    print(f"\nResultado: {ok} parchados, {fallos} con error. Revisa con `git diff` antes de hacer commit.")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
