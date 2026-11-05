#!/usr/bin/env python3
"""
aplicar_sync.py (v2) — Parchea los HTML ORIGINALES del repo:
  · Sincronización manual/automática (isa-sync.js) + tarjeta en Ajustes de index.
  · Portada: agrega «Resumen de Cosechadoras».
  · Barra superior estándar con icono «Inicio» en Seguimiento, Resumen y Diseño (isa-barra.css) + tipografía/color unificados.
  · Sello de cambios: el planificador lo publica al guardar; los módulos lo usan para NO releer todo (isa-sello.js).

Uso:   python3 herramientas/aplicar_sync.py RUTA_DEL_REPO [--dry-run]

Seguro: cada ancla debe existir EXACTAMENTE una vez; si alguna falla, ese archivo NO se escribe (todo o nada por archivo).
Crea <archivo>.bak. Aplícalo sobre los HTML originales (sin parches previos): si un archivo ya trae isa-barra.css, se omite.
"""
import re, sys, shutil
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ_PAQUETE = AQUI.parent
V = "?v=2"                                   # sube el número si cambias estos archivos (caché de GitHub Pages)
TAG_SYNC = f'<script src="isa-sync.js{V}"></script>'
TAG_SELLO = f'<script src="isa-sello.js{V}"></script>'
LINK_BARRA = f'<link rel="stylesheet" href="isa-barra.css{V}">'
LINK_TABLER = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/tabler-icons.min.css">'
SISTEMA = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
ARCHIVOS_NUEVOS = ["isa-sync.js", "isa-sello.js", "isa-barra.css"]


class Fallo(Exception):
    pass


def una_vez(txt, patron, repl, etiqueta, flags=0, literal=False):
    """Sustituye exactamente una coincidencia; si hay 0 o >1, falla."""
    rx = re.compile(re.escape(patron) if literal else patron, flags)
    n = len(rx.findall(txt))
    if n != 1:
        raise Fallo(f"{etiqueta}: se esperaba 1 coincidencia y hay {n}")
    return rx.sub(lambda m: repl(m) if callable(repl) else (repl if literal else m.expand(repl)), txt, count=1)


def antes_del_primero(txt, marca, nuevo, etiqueta):
    i = txt.find(marca)
    if i < 0:
        raise Fallo(f"{etiqueta}: no encuentro «{marca}»")
    return txt[:i] + nuevo + "\n" + txt[i:]


# ════════════════════════════ seguimiento_cosecha.html ════════════════════════════
def parche_seguimiento(t):
    t = una_vez(t, "<title>Seguimiento de Cosecha — módulo independiente</title>", "<title>Seguimiento del Plan · Cosecha ISA</title>", "seg/title", literal=True)
    # scripts: isa-sync.js justo tras el SDK de Firestore (carga antes del script principal)
    t = una_vez(t, '<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>',
                '<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>\n' + TAG_SYNC, "seg/script sync", literal=True)
    t = antes_del_primero(t, "<style>", LINK_BARRA, "seg/css barra")
    # barra estándar
    t = una_vez(t, '<header class="sgp-top">', '<header class="isa-barra">', "seg/header", literal=True)
    t = una_vez(t, '<span class="sgp-title">Seguimiento de Cosecha</span>',
                '<span class="isa-titulo">Seguimiento del Plan</span><span id="isa-sync-chip" class="isa-sync-chip" aria-live="polite"></span>', "seg/titulo", literal=True)
    # estado compartido + helpers del sello (antes de la caché local)
    t = una_vez(t, "var DB=null, fbDb=null, fbAuth=null;",
                "var DB=null, fbDb=null, fbAuth=null;\n"
                "/* Sello de cambios: el planificador cambia el token de una categoría al terminar de guardarla. Aquí solo se relee lo que cambió. */\n"
                "var CATS_SGP=['plan','campos','ejecucion','equipos','labores'],CAMPO_SGP={plan:'planItems',campos:'campos',ejecucion:null,equipos:null,labores:'laboresPlan'},CAT_CACHE={},SELLO_PREV=null;\n"
                "function tokSGP(s,c){return s&&s.cats&&typeof s.cats[c]==='string'&&s.cats[c]?s.cats[c]:null;}\n"
                "function clon(o){return typeof structuredClone==='function'?structuredClone(o):JSON.parse(JSON.stringify(o));}\n"
                "function leerSelloSGP(){return fbDb.collection(COL).doc('sello').get().then(function(d){return d.exists?(d.data()||{}):null;});}",
                "seg/estado sello", literal=True)
    t = una_vez(t, "recargar:function(){if(fbDb&&S.user)leerDesdeFirestore();else render();}",
                "recargar:function(ctx){if(fbDb&&S.user)return leerDesdeFirestore(ctx);render();}", "seg/recargar", literal=True)
    # cabecera de leerDesdeFirestore: contexto, lectura del sello y salida rápida si nada cambió
    t = una_vez(t, r"async function leerDesdeFirestore\(\)\{\s*if\(_leyendo\)return;_leyendo=true;\s*var hayDB=!!DB,hechos=0,total=5,lento=null;",
                "async function leerDesdeFirestore(ctx){\n"
                "  if(_leyendo)return false;_leyendo=true;\n"
                "  var auto=!!(ctx&&ctx.auto===true),completa=!auto||!!ctx.completa,sello=null,cambiadas=CATS_SGP.slice();\n"
                "  try{sello=await leerSelloSGP();}catch(e){sello=null;}   // sin sello (o sin permiso): lectura completa de siempre\n"
                "  if(sello&&!completa&&SELLO_PREV){cambiadas=CATS_SGP.filter(function(c){var a=tokSGP(sello,c);return !a||a!==tokSGP(SELLO_PREV,c)||!CAT_CACHE[c];});}\n"
                "  if(auto&&!completa&&sello&&SELLO_PREV&&DB&&!cambiadas.length){\n"
                "    _leyendo=false;setSync('Sin cambios · comprobado '+fechaCorta(Date.now()),'');\n"
                "    try{ISASync.marcar('seguimiento',true,false);}catch(e){}\n"
                "    return true;\n"
                "  }\n"
                "  var hayDB=!!DB,hechos=0,total=cambiadas.length||CATS_SGP.length,lento=null;",
                "seg/cabecera leer", flags=re.S)
    t = una_vez(t, r"var lectura=Promise\.all\(\[marca\(leerCategoria\('plan','planItems'\)\),marca\(leerCategoria\('campos','campos'\)\),marca\(leerCategoria\('ejecucion',null\)\),marca\(leerCategoria\('equipos',null\)\),marca\(leerCategoria\('labores','laboresPlan'\)\)\]\);",
                "var lectura=Promise.all(CATS_SGP.map(function(c){\n"
                "      if(cambiadas.indexOf(c)<0)return Promise.resolve(CAT_CACHE[c]);   // sello sin cambios: se usa lo ya leído\n"
                "      return marca(leerCategoria(c,CAMPO_SGP[c])).then(function(v){if(v)CAT_CACHE[c]=v;else delete CAT_CACHE[c];return v;});\n"
                "    }));", "seg/lectura incremental")
    t = una_vez(t, r"var r=await Promise\.race\(\[lectura,tope\]\);",
                "var r=await Promise.race([lectura,tope]);\n    r=r.map(function(x){return x?clon(x):x;});   // copia: lo que se muta después no daña la caché", "seg/clon")
    t = una_vez(t, r"DB=nuevo;cacheGuardar\(d\);", "DB=nuevo;cacheGuardar(d);SELLO_PREV=sello;", "seg/sello previo")
    t = una_vez(t, r"clearTimeout\(lento\);_leyendo=false;(\s*)if\(!hayDB\)S\.zafra='';(\s*)render\(\);(\s*)\}",
                lambda m: ("clearTimeout(lento);_leyendo=false;" + m.group(1) + "if(!hayDB)S.zafra='';" + m.group(2) + "render();" + m.group(2) +
                           "try{ISASync.marcar('seguimiento',S.srcOk,completa);}catch(e){}" + m.group(2) + "return S.srcOk;" + m.group(3) + "}"),
                "seg/cierre leer")
    t = una_vez(t, "SGP.mount(document.getElementById('sgp-root'));",
                "SGP.mount(document.getElementById('sgp-root'));\n"
                "if(typeof ISASync!=='undefined'){\n"
                "  ISASync.registrar({id:'seguimiento',nombre:'Seguimiento del Plan',\n"
                "    permitido:function(){return !!SGP.api.state.user;},\n"
                "    ejecutar:function(ctx){return SGP.api.recargar(ctx);}});\n"
                "  ISASync.montarChip('seguimiento','isa-sync-chip');\n}", "seg/registro", literal=True)
    return t


# ════════════════════════════ diseno_lotes.html ════════════════════════════
LEER_DE_BASE_V2 = """async function leerDeBase(ctx) {
  if (typeof ISA === 'undefined' || leyendoBase) return false;
  leyendoBase = true; $('b-isa-leer').disabled = true;
  var auto = !!(ctx && ctx.auto === true), completa = !auto || !!ctx.completa;   // un clic del botón (ctx = evento) es lectura completa
  var zPrev = $('p-zafra').value, ok = false;
  try {
    var sello = null;
    try { sello = ISA.sello ? await ISA.sello() : null; } catch (e) { sello = null; }   // sin sello (o sin permiso): lectura completa de siempre
    if (completa) estado.cachePlan = {};
    if (!completa && estado.planOrigen === 'base' && estado.plan && ISA.selloIgual && ISA.selloIgual(estado.selloPlan, sello)) {
      /* el sello no cambió: el plan que ya está en pantalla sigue vigente, no se baja nada */
    } else {
      var plan = ISA.leerPlanInc
        ? await ISA.leerPlanInc(function(t) { mensaje('e-plan', t); }, { sello: sello, cache: (estado.cachePlan = estado.cachePlan || {}), compartir: ['geodata'] })
        : await ISA.leerPlan(function(t) { mensaje('e-plan', t); });
      aceptarPlan(plan, 'Base del planificador');
      estado.planOrigen = 'base'; estado.selloPlan = sello;
      // aceptarPlan reinicia el selector de zafra: se conserva la elección del usuario si sigue existiendo
      if (zPrev && Array.from($('p-zafra').options).some(function(o) { return o.value === zPrev; })) $('p-zafra').value = zPrev;
    }
    ok = (await leerRegistroDeBase(ctx)) !== false;
  }
  catch (e) { mensaje('e-plan', 'No se pudo leer la base: ' + e.message + ' También puedes usar el archivo .json.', 'error'); }
  finally { leyendoBase = false; $('b-isa-leer').disabled = false; }
  try { ISASync.marcar('diseno', ok, completa); } catch (e) {}
  return ok;
}
/* Sincronización manual/automática (configurada en index → Ajustes). No toca datos cargados desde archivo .json. */
if (typeof ISASync !== 'undefined') {
  ISASync.registrar({ id: 'diseno', nombre: 'Diseño de Lotes',
    permitido: function() { var s = ISA.sesion && ISA.sesion(); return !!(s && s.user && s.listo && s.rol) && estado.planOrigen === 'base'; },
    ocupado: function() { return leyendoBase || leyendoReg; },
    ejecutar: leerDeBase });
  ISASync.montarChip('diseno', 'isa-sync-chip');
}"""


def parche_diseno(t):
    t = una_vez(t, "<title>Diseño de lotes · Cosecha</title>", "<title>Diseño de Lotes · Cosecha ISA</title>", "dis/title", literal=True)
    # tipografía: se quita Barlow (Google Fonts) y se usa la pila de sistema del resto del proyecto
    t = una_vez(t, r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\s*<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\s*<link href="https://fonts\.googleapis\.com/css2\?family=Barlow[^"]*" rel="stylesheet">',
                LINK_TABLER + "\n" + LINK_BARRA, "dis/fonts")
    for viejo in ["'Barlow Semi Condensed', 'Barlow', 'Arial Narrow', Arial, sans-serif", "'Barlow', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                  "'Barlow Semi Condensed', sans-serif", "'Barlow', sans-serif"]:
        if viejo not in t:
            raise Fallo(f"dis/fuente: no encuentro {viejo[:30]}")
        t = t.replace(viejo, SISTEMA)   # puede aparecer en varias reglas CSS
    if "Barlow" in t:
        raise Fallo("dis/fuente: quedan referencias a Barlow")
    t = una_vez(t, "--hoja: #23452F;", "--hoja: #0D4934;", "dis/color", literal=True)
    # barra estándar en lugar del héroe verde
    t = una_vez(t, r'<header class="campo">\s*<h1>(.*?)</h1>\s*<p>(.*?)</p>\s*</header>\s*<main>',
                lambda m: ('<header class="isa-barra"><a href="index.html" class="isa-btn" title="Volver a la portada"><i class="ti ti-home" aria-hidden="true"></i> Inicio</a>'
                           '<span class="isa-titulo">Diseño de Lotes</span><span id="isa-sync-chip" class="isa-sync-chip" aria-live="polite"></span></header>\n'
                           '<main>\n  <div class="isa-intro"><h1>' + m.group(1) + '</h1><p>' + m.group(2) + '</p></div>'),
                "dis/header", flags=re.S)
    t = una_vez(t, '<script src="isa-conexion.js"></script>', '<script src="isa-conexion.js"></script>\n' + TAG_SELLO + "\n" + TAG_SYNC, "dis/scripts", literal=True)
    # leerRegistroDeBase: contexto + atajo por versión + devuelve éxito
    t = una_vez(t, "async function leerRegistroDeBase() {",
                "function firmaVersiones(meta) { var z = (meta && meta.zafras) || {}; return JSON.stringify(Object.keys(z).sort().map(function(k) { return [k, z[k].version]; })); }\n"
                "async function leerRegistroDeBase(ctx) {", "dis/firma versiones", literal=True)
    t = una_vez(t, r"(leyendoReg = true; \$\('b-reg-leer'\)\.disabled = true;\s*try \{)",
                r"\1\n    var soloVer = !!(ctx && ctx.auto === true && !ctx.completa);   // disparo automático: solo se relee si cambió alguna versión del registro\n"
                r"    if (soloVer && estado.regVers) { var m0 = await ISA.registro.meta(); if (firmaVersiones(m0) === estado.regVers) return true; }", "dis/atajo versión")
    t = una_vez(t, r"(var res = await ISA\.registro\.leerTodo\(function\(t\) \{ mensaje\('e-regbase', t\); \}\), zs = Object\.keys\(res\.zafras\)\.sort\(\);)",
                r"\1\n    estado.regVers = firmaVersiones(res.meta);", "dis/guardar versiones")
    t = una_vez(t, r"(refrescarMaquinas\(true\);)(\s*\} catch \(e\) \{ mensaje\('e-regbase', 'No se pudo leer el registro de la base: )", r"\1\n    return true;\2", "dis/return true")
    t = una_vez(t, r"(También puedes cargar los CSV del Sheet\.', 'error'\);) \}(\s*finally \{ leyendoReg = false;)", r"\1 return false; }\2", "dis/return false")
    t = una_vez(t, r"async function leerDeBase\(\)\s*\{.*?\n\}", lambda m: LEER_DE_BASE_V2, "dis/leerDeBase", flags=re.S)
    return t


# ════════════════════════════ resumen_cosechadoras.html ════════════════════════════
def parche_resumen(t):
    t = una_vez(t, "<title>Resumen de cosechadoras por lote y zafra</title>", "<title>Resumen de Cosechadoras · Cosecha ISA</title>", "res/title", literal=True)
    t = antes_del_primero(t, "<style>", LINK_TABLER + "\n" + LINK_BARRA, "res/css")
    t = una_vez(t, "--accent:#2F6B4D;", "--accent:#0D4934;", "res/color", literal=True)
    t = una_vez(t, r"<body>\s*<main>",
                '<body>\n<header class="isa-barra"><a href="index.html" class="isa-btn" title="Volver a la portada"><i class="ti ti-home" aria-hidden="true"></i> Inicio</a>'
                '<span class="isa-titulo">Resumen de Cosechadoras</span><span id="isa-sync-chip" class="isa-sync-chip" aria-live="polite"></span></header>\n<main>', "res/header")
    t = una_vez(t, '<script src="isa-conexion.js"></script>', '<script src="isa-conexion.js"></script>\n' + TAG_SYNC, "res/script", literal=True)
    t = una_vez(t, "async function leerBase() {", "async function leerBase(soloZ) {   // soloZ: lista de zafras a releer (el botón pasa un evento: se ignora)", "res/firma", literal=True)
    t = una_vez(t, 'var res = await ISA.registro.leerTodo(function (t) { stBase(t); });',
                'var res = await ISA.registro.leerTodo(function (t) { stBase(t); }, Array.isArray(soloZ) ? soloZ : undefined);', "res/leerTodo", literal=True)
    t = una_vez(t, r'(\n)(\s*)\} catch \(e\) \{ stBase\("No se pudo leer el registro de la base: " \+ e\.message, "bad"\); \}(\s*finally \{ leyendoBase = false; \})',
                lambda m: (m.group(1) + m.group(2) + '  try { ISASync.marcar("resumen", true, !Array.isArray(soloZ)); } catch (e2) {}\n' + m.group(2) + '  return true;\n' + m.group(2) +
                           '} catch (e) { try { ISASync.marcar("resumen", false); } catch (e2) {} stBase("No se pudo leer el registro de la base: " + e.message, "bad"); return false; }' + m.group(3)),
                "res/leerBase cierre")
    t = una_vez(t, '$("b-isa-leer").addEventListener("click", leerBase);',
                '$("b-isa-leer").addEventListener("click", leerBase);\n'
                '    var inicio = document.querySelector(\'.isa-barra a[href="index.html"]\');   // no perder zafras procesadas y sin guardar\n'
                '    if (inicio) inicio.addEventListener("click", function (ev) {\n'
                '      var pend = Object.keys(tocadas).some(function (z) { return tocadas[z] && registro[z]; });\n'
                '      if (pend && !confirm("Hay zafras procesadas que no se han guardado en la base. Si sales, se pierden. ¿Salir de todos modos?")) ev.preventDefault();\n'
                '    });\n'
                '    if (typeof ISASync !== "undefined") {   // sincronización manual/automática (index → Ajustes)\n'
                '      ISASync.registrar({ id: "resumen", nombre: "Resumen de Cosechadoras",\n'
                '        permitido: function () { var s = ISA.sesion && ISA.sesion(); return !!(s && s.user && s.listo && s.rol); },\n'
                '        ocupado: function () { return leyendoBase || guardandoBase || corriendo; },\n'
                '        ejecutar: async function (ctx) {   // por versión de «meta»: nada que leer, o solo las zafras que cambiaron\n'
                '          if (ctx && ctx.auto === true && !ctx.completa) {\n'
                '            try {\n'
                '              var meta = await ISA.registro.meta(), mz = meta.zafras || {}, vb = Object.keys(versionBase);\n'
                '              if (vb.length && !vb.some(function (z) { return !(z in mz); })) {\n'
                '                var cambiadas = Object.keys(mz).filter(function (z) { return versionBase[z] !== mz[z].version; });\n'
                '                return cambiadas.length ? leerBase(cambiadas) : true;\n'
                '              }\n'
                '            } catch (e) { /* si la comprobación falla, lectura completa */ }\n'
                '          }\n'
                '          return leerBase();\n'
                '        } });\n'
                '      ISASync.montarChip("resumen", "isa-sync-chip");\n    }', "res/registro", literal=True)
    return t


# ════════════════════════════ index.html ════════════════════════════
FB_SELLO_FUNCS = """/* ── Sello de cambios ──────────────────────────────────────────────────────────────────────────────────────────────
   Documento planificador_compartido/sello: { cats: { campos:'token', plan:'token', … }, actualizado, usuario }.
   El token de una categoría cambia SOLO cuando TODAS sus partes ya se escribieron bien. Los módulos lectores (Seguimiento,
   Diseño de lotes, Resumen) comparan tokens y releen solo lo que cambió, en vez de bajar toda la base en cada ciclo.
   Si el sello falla al escribirse, los módulos igual releen todo cada «lectura completa de seguridad» (Ajustes). */
var fbSelloPend = {}, fbSelloTimer = null;
function fbEscribirSello(cat) {
  if (!fbDb || !fbUsuarioActual) return;
  fbSelloPend[cat] = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  clearTimeout(fbSelloTimer);
  fbSelloTimer = setTimeout(function() {   // agrupa varias categorías guardadas casi a la vez en UNA escritura
    var cats = fbSelloPend; fbSelloPend = {};
    fbDb.collection(FB_COLECCION).doc('sello').set({ cats: cats, actualizado: new Date().toISOString(), usuario: fbUsuarioActual.email }, { merge: true })
      .catch(function(err) { console.warn('No se pudo actualizar el sello de cambios (los módulos usarán la lectura completa de seguridad)', err); });
  }, 400);
}
/* Crea o renueva el sello de TODAS las categorías (botón en Ajustes; solo admin/editor). */
function fbPublicarSelloCompleto() {
  if (!fbDb || !fbUsuarioActual) return Promise.reject(new Error('Sin sesión'));
  var cats = {}, t = Date.now().toString(36);
  FB_DOCS.forEach(function(c) { cats[c] = t + '-' + c; });
  return fbDb.collection(FB_COLECCION).doc('sello').set({ cats: cats, actualizado: new Date().toISOString(), usuario: fbUsuarioActual.email }, { merge: true });
}

"""


def parche_index(t):
    src = (AQUI / "ajustes-sync-index.html").read_text(encoding="utf-8")
    i = src.find('<div class="card" id="card-sync">'); j = src.find("<script>", i); k = src.find("</script>", j)
    if min(i, j, k) < 0:
        raise Fallo("index: ajustes-sync-index.html no tiene el formato esperado")
    tarjeta, js = src[i:j].rstrip() + "\n", src[j:k + len("</script>")]
    rz = re.compile(r'(id="config-zafra-default-status"[^>]*></span>\s*</div>\s*</div>)')
    if len(rz.findall(t)) == 1:
        t = rz.sub(lambda m: m.group(1) + "\n\n      " + tarjeta, t, count=1)
    else:
        rx = re.compile(r'(<div id="page-ajustes"[^>]*>\s*(?:<div class="page-title">.*?</div>)?)', re.S)
        if len(rx.findall(t)) != 1:
            raise Fallo('index: no encuentro (una vez) <div id="page-ajustes">')
        t = rx.sub(lambda m: m.group(1) + "\n" + tarjeta, t, count=1)
    t = una_vez(t, r"(function syncAjustesPage\(\)\s*\{)", r"\1\n  if (typeof syncAjustesSyncCard === 'function') syncAjustesSyncCard();", "idx/syncAjustesPage")
    if t.count("</body>") != 1:
        raise Fallo("idx: no encuentro (una vez) </body>")
    t = t.replace("</body>", TAG_SYNC + "\n" + js + "\n</body>", 1)
    # portada: Resumen de Cosechadoras (antes de Diseño de Lotes: el resumen alimenta al diseño)
    t = una_vez(t, '<li><a href="diseno_lotes.html" id="portada-diseno-lotes">',
                '<li><a href="resumen_cosechadoras.html" id="portada-resumen"><span class="portada-cuadro" aria-hidden="true"><i class="ti ti-report-analytics"></i></span>Resumen de Cosechadoras'
                '<i class="ti ti-chevron-right portada-flecha" aria-hidden="true"></i></a></li>\n        <li><a href="diseno_lotes.html" id="portada-diseno-lotes">', "idx/portada li", literal=True)
    t = una_vez(t, "var MODULOS={'portada-seguimiento':'seguimiento_cosecha.html','portada-diseno-lotes':'diseno_lotes.html'};",
                "var MODULOS={'portada-seguimiento':'seguimiento_cosecha.html','portada-resumen':'resumen_cosechadoras.html','portada-diseno-lotes':'diseno_lotes.html'};", "idx/portada MODULOS", literal=True)
    # sello: se publica cuando TERMINA de guardarse una categoría
    t = una_vez(t, "function guardarEnFirestore(dataOpc) {", FB_SELLO_FUNCS + "function guardarEnFirestore(dataOpc) {", "idx/funciones sello", literal=True)
    t = una_vez(t, r"(fbFirmaCat\[nombreCat\] = firmas\[nombreCat\];[^\n]*\n)", r"\1    var pCat = [];   // una promesa por parte escrita: el sello se publica solo si TODAS terminaron bien\n", "idx/pCat")
    t = una_vez(t, r"fbDb\.collection\(FB_COLECCION\)\.doc\(docId\)\.set\(parteSaneada, \{ merge: false \}\)(\s*)\.then\(function\(\) \{",
                lambda m: ("var prSet = fbDb.collection(FB_COLECCION).doc(docId).set(parteSaneada, { merge: false });\n"
                           "        pCat.push(prSet.then(function() { return true; }, function() { return false; }));\n"
                           "        prSet" + m.group(1) + ".then(function() {"), "idx/set promesa")
    t = una_vez(t, r"(\n\s*)(// Borrar partes SOBRANTES de un guardado anterior)",
                lambda m: (m.group(1) + "Promise.all(pCat).then(function(oks) { if (oks.length && oks.every(Boolean)) fbEscribirSello(nombreCat); });" + m.group(1) + m.group(2)), "idx/publicar sello")
    return t


ARCHIVOS = [("index.html", parche_index), ("seguimiento_cosecha.html", parche_seguimiento),
            ("diseno_lotes.html", parche_diseno), ("resumen_cosechadoras.html", parche_resumen)]


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
        if "isa-barra.css" in txt or "isa-sync.js?v=2" in txt:
            print(f"[=]  {nombre}: ya tiene esta versión, se omite"); continue
        if "isa-sync.js" in txt:
            fallos += 1; print(f"[!!] {nombre}: trae el parche v1 (isa-sync.js sin sello). Restaura el original (git checkout -- {nombre}) y vuelve a ejecutar."); continue
        try:
            nuevo = fn(txt)
        except Fallo as e:
            fallos += 1; print(f"[!!] {nombre}: NO modificado → {e}"); continue
        if not seco:
            shutil.copy2(ruta, ruta.with_suffix(ruta.suffix + ".bak"))
            ruta.write_text(nuevo, encoding="utf-8", newline="")
        ok += 1; print(f"[OK] {nombre}: {'(simulado) ' if seco else ''}parchado")
    if not seco:
        for f in ARCHIVOS_NUEVOS:
            shutil.copy2(RAIZ_PAQUETE / f, repo / f)
        print("[OK] copiados a la raíz del repo: " + ", ".join(ARCHIVOS_NUEVOS))
    print(f"\nResultado: {ok} parchados, {fallos} con error. Revisa con `git diff` antes de hacer commit.")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
