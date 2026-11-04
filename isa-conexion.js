/*
  isa-conexion.js — Conexión compartida de los módulos de Cosecha (Ingenio San Antonio)

  OJO: este archivo NO es la base de datos ni guarda datos. Los datos viven en Firebase (colección planificador_compartido).
  Este archivo es solo el «conector» que usan los módulos para llegar a esa base: inicio de sesión, roles y lectura.

  Qué hace
    · Se conecta al MISMO proyecto de Firebase que el Planificador de Cosecha (mismo inicio de sesión, mismos roles).
    · Lee los datos del planificador (campos, plan, equipos, polígonos) y los devuelve con la misma forma que el .json
      que exporta el planificador, para que cualquier módulo los use igual venga de la base o de un archivo.
    · Informa el rol del usuario (admin / editor / visor) y, más adelante, a qué módulos tiene acceso.

  Qué NO hace (en esta versión)
    · No escribe nada en la base. El planificador es el único que escribe en sus categorías
      (planificador_compartido): los módulos guardarán sus resultados en colecciones propias (fase siguiente).

  Cómo se usa en una página de módulo
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
    <script src="isa-conexion.js"></script>
    ... ISA.iniciar(); ISA.alCambiarSesion(function (s) { ... }); var datos = await ISA.leerPlan();
*/
(function (global) {
  'use strict';

  var VERSION = '1.0';
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

  global.ISA = {
    version: VERSION, iniciar: iniciar, disponible: disponible, login: login, logout: logout, alCambiarSesion: alCambiarSesion,
    sesion: function () { return sesion; }, puedeLeer: puedeLeer, tieneModulo: tieneModulo,
    leerPlan: leerPlan, leerCategoria: leerCategoria, restaura: restaura,
    COL: COL, COL_ROLES: COL_ROLES
  };
})(typeof window !== 'undefined' ? window : this);
