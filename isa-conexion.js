/*
  isa-conexion.js — Conexión compartida de los módulos de Cosecha (Ingenio San Antonio)

  OJO: este archivo NO es la base de datos ni guarda datos. Los datos viven en Firebase (colección planificador_compartido).
  Este archivo es solo el «conector» que usan los módulos para llegar a esa base: inicio de sesión, roles y lectura.

  Qué hace
    · Se conecta al MISMO proyecto de Firebase que el Planificador de Cosecha (mismo inicio de sesión, mismos roles).
    · Lee los datos del planificador (campos, plan, equipos, polígonos) y los devuelve con la misma forma que el .json
      que exporta el planificador, para que cualquier módulo los use igual venga de la base o de un archivo.
    · Informa el rol del usuario (admin / editor / visor) y, más adelante, a qué módulos tiene acceso.

  Qué escribe
    · NADA en planificador_compartido: el planificador es el único que escribe en sus categorías.
    · Los módulos guardan sus resultados en colecciones PROPIAS:
        registro_cosechadoras  (lo escribe «Resumen de cosechadoras»; lo lee el módulo de diseño)
        registro_operadores    (nombres de los operadores, con permiso explícito)

  Cómo se usa en una página de módulo
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
    <script src="isa-conexion.js"></script>
    ... ISA.iniciar(); ISA.alCambiarSesion(function (s) { ... }); var datos = await ISA.leerPlan();
*/
(function (global) {
  'use strict';

  var VERSION = '2.0';
  var FB_CONFIG = {
    apiKey: 'AIzaSyD489aJJ6xGniyinLzm3AJZn3C3qz0RNzA',
    authDomain: 'planificador-de-cosecha.firebaseapp.com',
    projectId: 'planificador-de-cosecha',
    storageBucket: 'planificador-de-cosecha.firebasestorage.app',
    messagingSenderId: '136366145229',
    appId: '1:136366145229:web:af3067a259216b6bc7b384',
    measurementId: 'G-0DSZBP5KVQ'
  };
  var COL = 'planificador_compartido';     // datos del planificador (solo lectura desde los módulos)
  var COL_ROLES = 'usuarios_roles';        // un documento por correo: { rol: 'admin' | 'editor' | 'visor', modulos?: [...] }
  var ROLES_LECTURA = ['admin', 'editor', 'visor'];
  var CATEGORIAS_PLAN = ['campos', 'plan', 'equipos', 'geodata'];   // lo que necesitan los módulos (molienda, ejecución y vialidad no)

  var fb = { db: null, auth: null, iniciado: false, error: null };
  var sesion = { user: null, email: null, rol: null, modulos: null, listo: false };
  var escuchas = [];

  function notificar() { escuchas.slice().forEach(function (f) { try { f(sesion); } catch (e) { if (global.console) console.warn('isa-conexion: error en un oyente de sesión', e); } }); }
  function disponible() { return typeof global.firebase !== 'undefined' && !!global.firebase.initializeApp; }

  /* Inicia Firebase y vigila la sesión. Devuelve false si no se cargó el SDK (por ejemplo, sin internet). */
  function iniciar() {
    if (fb.iniciado) return true;
    if (!disponible()) return false;
    try {
      if (!global.firebase.apps || !global.firebase.apps.length) global.firebase.initializeApp(FB_CONFIG);
      fb.auth = global.firebase.auth(); fb.db = global.firebase.firestore(); fb.iniciado = true;
      fb.auth.onAuthStateChanged(function (u) {
        sesion.user = u || null; sesion.email = u ? String(u.email || '').toLowerCase() : null; sesion.rol = null; sesion.modulos = null; sesion.listo = !u;
        notificar();
        if (!u) return;
        leerRol(sesion.email).then(function (r) { sesion.rol = r.rol; sesion.modulos = r.modulos; sesion.listo = true; notificar(); })
          .catch(function () { sesion.rol = null; sesion.listo = true; notificar(); });
      });
      return true;
    } catch (e) { fb.error = e; return false; }
  }

  function leerRol(email) {
    return fb.db.collection(COL_ROLES).doc(email).get().then(function (d) {
      var x = d.exists ? d.data() : {};
      return { rol: x.rol || null, modulos: Array.isArray(x.modulos) ? x.modulos : null };
    });
  }

  function mensajeError(err) {
    var c = err && err.code;
    if (c === 'auth/too-many-requests') return 'Demasiados intentos. Espera unos minutos.';
    if (c === 'auth/network-request-failed') return 'Sin conexión a internet.';
    if (c === 'auth/invalid-email') return 'El correo no es válido.';
    if (c === 'auth/user-disabled') return 'Este usuario está deshabilitado.';
    return 'Correo o contraseña incorrectos.';
  }
  function login(email, pass) {
    if (!fb.iniciado) return Promise.reject(new Error('No se cargó Firebase. Revisa tu conexión a internet.'));
    return fb.auth.signInWithEmailAndPassword(String(email || '').trim(), pass || '').catch(function (err) { throw new Error(mensajeError(err)); });
  }
  function logout() { return fb.iniciado ? fb.auth.signOut() : Promise.resolve(); }
  function alCambiarSesion(f) { escuchas.push(f); if (fb.iniciado) { try { f(sesion); } catch (e) {} } }

  /* ¿Puede leer? (el rol viene de usuarios_roles; las reglas de Firestore lo vuelven a comprobar en el servidor) */
  function puedeLeer() { return !!sesion.user && ROLES_LECTURA.indexOf(sesion.rol) >= 0; }
  /* ¿Tiene acceso a un módulo? Hoy: cualquier rol con lectura. Más adelante: la lista «modulos» del usuario (admin siempre entra). */
  function tieneModulo(nombre) {
    if (!puedeLeer()) return false;
    if (sesion.rol === 'admin' || !sesion.modulos) return true;
    return sesion.modulos.indexOf(nombre) >= 0;
  }

  /* Deshace el envoltorio {__na:true, v:"..."} con que el planificador guarda los arreglos anidados (Firestore no los admite). */
  function restaura(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(restaura);
    if (v.__na === true && typeof v.v === 'string') { try { return JSON.parse(v.v); } catch (e) { return []; } }
    var o = {}; Object.keys(v).forEach(function (k) { o[k] = restaura(v[k]); }); return o;
  }

  /* Lee una categoría del planificador. Cada categoría vive en documentos «categoria_0», «categoria_1»… con la forma
     { meta, items, itemsField, part, totalParts }. Se unen en un solo objeto. Si falta alguna parte, se avisa (no se devuelve a medias). */
  function leerCategoria(cat) {
    var col = fb.db.collection(COL);
    return col.doc(cat + '_0').get().then(function (d0) {
      if (!d0.exists) return null;
      var p0 = restaura(d0.data()), total = p0.totalParts || 1, pend = [], i;
      for (i = 1; i < total; i++) pend.push(col.doc(cat + '_' + i).get());
      return Promise.all(pend).then(function (docs) {
        var partes = [p0]; docs.forEach(function (d) { if (d.exists) partes.push(restaura(d.data())); });
        if (partes.length < total) throw new Error('La categoría «' + cat + '» está incompleta en la base (' + partes.length + ' de ' + total + ' partes). Espera un momento a que el planificador termine de guardar y vuelve a intentar.');
        partes.sort(function (a, b) { return (a.part || 0) - (b.part || 0); });
        var r = Object.assign({}, p0.meta || {}), campo = p0.itemsField;
        if (campo) { var todo = []; partes.forEach(function (p) { todo = todo.concat(p.items || []); }); r[campo] = todo; }
        return { datos: r, partes: partes.length };
      });
    });
  }

  /* Lee los datos del planificador que usan los módulos y los devuelve con la misma forma que su .json exportado:
     campos, planItems, modelosCosech, tablas de velocidad (velVPV…), geoFeatures, etc. */
  function leerPlan(progreso) {
    if (!fb.iniciado) return Promise.reject(new Error('No se cargó Firebase. Revisa tu conexión a internet o usa el archivo .json.'));
    if (!sesion.user) return Promise.reject(new Error('Inicia sesión con tu usuario del planificador.'));
    if (!puedeLeer()) return Promise.reject(new Error('Tu usuario no tiene un rol asignado en el planificador. Pide a un administrador que te lo asigne.'));
    var avisa = function (t) { if (progreso) progreso(t); };
    avisa('Leyendo la base del planificador…');
    var hechas = 0;
    return Promise.all(CATEGORIAS_PLAN.map(function (cat) {
      return leerCategoria(cat).then(function (r) { hechas++; avisa('Leyendo la base del planificador… (' + hechas + ' de ' + CATEGORIAS_PLAN.length + ')'); return r; });
    })).then(function (rs) {
      var por = {}; CATEGORIAS_PLAN.forEach(function (c, i) { por[c] = rs[i]; });
      if (!por.campos || !por.campos.datos.campos) throw new Error('No encontré los campos del planificador en la base.');
      if (!por.geodata || !por.geodata.datos.geoFeatures || !por.geodata.datos.geoFeatures.length) throw new Error('No encontré los polígonos de los lotes en la base (categoría geodata).');
      var d = Object.assign({}, por.equipos ? por.equipos.datos : {}, por.campos.datos, por.plan ? por.plan.datos : {}, por.geodata.datos);
      d.planItems = d.planItems || [];
      d._fuente = { origen: 'base', leidoEl: new Date().toISOString(), usuario: sesion.email, partes: CATEGORIAS_PLAN.reduce(function (o, c) { o[c] = por[c] ? por[c].partes : 0; return o; }, {}) };
      return d;
    });
  }

  /* ======================= REGISTRO DE COSECHADORAS =======================
     Colección registro_cosechadoras:
       meta                              { zafras: { '2025-2026': { version, actualizado, usuario, lotes, maquinas, dias, partes:{...} } } }
       z_<zafra>_<tipo>_v<version>_<i>   { zafra, tipo, ver, part, totalParts, enc:'gzip-b64', datos:'...' }   tipo = lotes | maquinas | dias | extra
     Cada tipo se guarda como JSON comprimido (gzip) en texto base64, partido en trozos que caben en un documento de Firestore.
     Al guardar se escribe una versión NUEVA completa y, al final, se cambia el puntero en «meta» con una transacción que comprueba
     que nadie guardó mientras tanto: así nadie ve datos a medias y dos personas no se pisan sin enterarse. */
  var COL_REG = 'registro_cosechadoras', COL_OPER = 'registro_operadores', DOC_META = 'meta', DOC_MAPA_OPER = 'mapa';
  var TIPOS_REG = ['lotes', 'maquinas', 'dias', 'extra'], MAX_TROZO = 600000;

  function aBase64(bytes) { var s = '', n = 0x8000; for (var i = 0; i < bytes.length; i += n) s += String.fromCharCode.apply(null, bytes.subarray(i, i + n)); return btoa(s); }
  function deBase64(b64) { var bin = atob(b64), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
  function comprimir(texto) {
    if (typeof CompressionStream === 'undefined') return Promise.reject(new Error('Este navegador no puede comprimir los datos. Usa una versión reciente de Chrome, Edge o Firefox.'));
    return new Response(new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer().then(function (ab) { return aBase64(new Uint8Array(ab)); });
  }
  function descomprimir(b64) { return new Response(new Blob([deBase64(b64)]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
  function puedeEditar() { return !!sesion.user && (sesion.rol === 'admin' || sesion.rol === 'editor'); }
  function refMeta() { return fb.db.collection(COL_REG).doc(DOC_META); }
  function idDoc(z, tipo, ver, i) { return 'z_' + z + '_' + tipo + '_v' + ver + '_' + i; }
  function errorPermiso(e, que) {
    if (e && e.code === 'permission-denied') return new Error('Tu usuario no tiene permiso para ' + que + '. Pide a un administrador que te lo asigne.');
    return e;
  }
  function registroMeta() { return refMeta().get().then(function (d) { var x = d.exists ? (d.data() || {}) : {}; x.zafras = x.zafras || {}; return x; }); }

  function registroLeerZafra(z, info) {
    var col = fb.db.collection(COL_REG), salida = { zafra: z, version: info.version, actualizado: info.actualizado || '', usuario: info.usuario || '' };
    return Promise.all(TIPOS_REG.map(function (tipo) {
      var n = (info.partes && info.partes[tipo]) || 0, pend = [], i;
      if (!n) return Promise.resolve(tipo === 'extra' ? {} : []);
      for (i = 0; i < n; i++) pend.push(col.doc(idDoc(z, tipo, info.version, i)).get());
      return Promise.all(pend).then(function (docs) {
        var partes = docs.filter(function (d) { return d.exists; }).map(function (d) { return d.data(); });
        if (partes.length < n) throw new Error('El registro de la zafra ' + z + ' está incompleto en la base (' + tipo + ': ' + partes.length + ' de ' + n + ' partes). Espera un momento y vuelve a intentar.');
        partes.sort(function (a, b) { return a.part - b.part; });
        return descomprimir(partes.map(function (p) { return p.datos; }).join('')).then(JSON.parse);
      });
    })).then(function (r) { salida.lotes = r[0]; salida.maquinas = r[1]; salida.dias = r[2]; salida.extra = r[3] || {}; return salida; });
  }
  /* Lee el registro de todas las zafras (o solo las de la lista «solo»). Devuelve { zafras: { '2025-2026': { version, lotes, maquinas, dias, extra } } }. */
  function registroLeerTodo(progreso, solo) {
    if (!fb.iniciado) return Promise.reject(new Error('No se cargó Firebase.'));
    if (!sesion.user || !puedeLeer()) return Promise.reject(new Error('Inicia sesión con un usuario que tenga rol en el planificador.'));
    if (progreso) progreso('Leyendo el registro de cosechadoras de la base…');
    return registroMeta().then(function (meta) {
      var zs = Object.keys(meta.zafras).filter(function (z) { return !solo || solo.indexOf(z) >= 0; }).sort(), hechas = 0, salida = {};
      return Promise.all(zs.map(function (z) {
        return registroLeerZafra(z, meta.zafras[z]).then(function (r) { salida[z] = r; hechas++; if (progreso) progreso('Leyendo el registro de cosechadoras… (' + hechas + ' de ' + zs.length + ' zafras)'); });
      })).then(function () { return { zafras: salida, meta: meta }; });
    }).catch(function (e) { throw errorPermiso(e, 'leer el registro de cosechadoras'); });
  }
  function conflicto(z) { var e = new Error('Otra persona guardó la zafra ' + z + ' mientras trabajabas. No se guardó nada. Lee el registro de nuevo y repite el proceso.'); e.code = 'conflicto'; return e; }
  /* Guarda UNA zafra completa: datos = { lotes:[], maquinas:[], dias:[], extra:{} }. opciones.versionEsperada = la versión que se leyó (0 si la zafra no existía). */
  function registroGuardarZafra(z, datos, opciones) {
    opciones = opciones || {};
    if (!fb.iniciado) return Promise.reject(new Error('No se cargó Firebase.'));
    if (!puedeEditar()) return Promise.reject(new Error('Tu usuario es de solo lectura (visor). Se necesita rol de editor o administrador para guardar.'));
    var col = fb.db.collection(COL_REG), avisa = opciones.progreso || function () {}, escritos = [], partes = {}, vActual = 0, actual = null, nv = 0;
    return registroMeta().then(function (meta) {
      actual = meta.zafras[z] || null; vActual = actual ? actual.version : 0;
      if (opciones.versionEsperada !== undefined && opciones.versionEsperada !== vActual) throw conflicto(z);
      nv = vActual + 1;
      var seq = Promise.resolve();
      TIPOS_REG.forEach(function (tipo) {
        seq = seq.then(function () {
          var cont = tipo === 'extra' ? (datos.extra || {}) : (datos[tipo] || []);
          if (tipo !== 'extra' && !cont.length) { partes[tipo] = 0; return; }
          avisa('Comprimiendo ' + tipo + '…');
          return comprimir(JSON.stringify(cont)).then(function (b64) {
            var trozos = []; for (var p = 0; p < b64.length; p += MAX_TROZO) trozos.push(b64.slice(p, p + MAX_TROZO));
            partes[tipo] = trozos.length;
            var s2 = Promise.resolve();
            trozos.forEach(function (t, i) {
              s2 = s2.then(function () { var id = idDoc(z, tipo, nv, i); escritos.push(id); avisa('Guardando ' + tipo + ' (' + (i + 1) + ' de ' + trozos.length + ')…');
                return col.doc(id).set({ zafra: z, tipo: tipo, ver: nv, part: i, totalParts: trozos.length, enc: 'gzip-b64', datos: t }); });
            });
            return s2;
          });
        });
      });
      return seq;
    }).then(function () {
      avisa('Publicando la nueva versión…');
      return fb.db.runTransaction(function (tx) {
        return tx.get(refMeta()).then(function (m) {
          var md = m.exists ? (m.data() || {}) : {}, za = Object.assign({}, md.zafras || {}), cur = za[z] ? za[z].version : 0;
          if (cur !== vActual) throw conflicto(z);
          za[z] = { version: nv, actualizado: new Date().toISOString(), usuario: sesion.email, lotes: (datos.lotes || []).length, maquinas: (datos.maquinas || []).length, dias: (datos.dias || []).length, partes: partes, versionScript: opciones.versionScript || '' };
          tx.set(refMeta(), { zafras: za });
        });
      });
    }).then(function () {
      if (actual && actual.partes) TIPOS_REG.forEach(function (tipo) { for (var i = 0; i < (actual.partes[tipo] || 0); i++) col.doc(idDoc(z, tipo, vActual, i)).delete().catch(function () {}); });   // limpieza de la versión anterior
      return { version: nv, partes: partes };
    }).catch(function (e) {
      escritos.forEach(function (id) { col.doc(id).delete().catch(function () {}); });   // no dejar versiones a medias
      throw errorPermiso(e, 'guardar el registro de cosechadoras');
    });
  }
  /* Nombres de los operadores (colección aparte, con permiso explícito). leer() devuelve null si el usuario no tiene permiso. */
  var operadores = {
    leer: function () {
      return fb.db.collection(COL_OPER).doc(DOC_MAPA_OPER).get().then(function (d) { return d.exists ? ((d.data() || {}).ids || {}) : {}; })
        .catch(function (e) { if (e && e.code === 'permission-denied') return null; throw e; });
    },
    guardar: function (ids) {
      return fb.db.collection(COL_OPER).doc(DOC_MAPA_OPER).set({ ids: ids, actualizado: new Date().toISOString(), usuario: sesion.email }, { merge: true })
        .then(function () { return true; }).catch(function (e) { if (e && e.code === 'permission-denied') return false; throw e; });
    }
  };

  global.ISA = {
    version: VERSION, iniciar: iniciar, disponible: disponible, login: login, logout: logout, alCambiarSesion: alCambiarSesion,
    sesion: function () { return sesion; }, puedeLeer: puedeLeer, tieneModulo: tieneModulo,
    leerPlan: leerPlan, leerCategoria: leerCategoria, restaura: restaura, puedeEditar: puedeEditar,
    registro: { meta: registroMeta, leerTodo: registroLeerTodo, guardarZafra: registroGuardarZafra, operadores: operadores },
    COL: COL, COL_ROLES: COL_ROLES
  };
})(typeof window !== 'undefined' ? window : this);
