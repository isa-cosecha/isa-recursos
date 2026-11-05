# Reglas de Firestore — revisión y despliegue

No pude leer las reglas que hoy están publicadas (viven en la Consola de Firebase, no en el repo). `firestore.rules` es una
PROPUESTA reconstruida a partir de lo que hace el código. Compárala con la actual antes de reemplazar nada.

## Lo que sí encontré en el código
1. **El sello necesita su propia regla.** El aviso de «labores» en index.html dice que el administrador tuvo que agregar la ruta
   `labores_0 … labores_7` a las reglas: las reglas enumeran los documentos permitidos de `planificador_compartido`.
   Entonces `planificador_compartido/sello` **será rechazado** hasta que se agregue. Sin esa regla nada se rompe: los módulos
   simplemente siguen leyendo todo en cada ciclo (el botón «Publicar sello de cambios» mostrará «permiso»).
   Bloque mínimo a agregar si no quieres reemplazar el archivo completo (dentro de `match /planificador_compartido/{docId}`):

       allow read: if <tu condición actual de lectura>;
       allow create, update: if <tu condición actual de edición> && docId == 'sello'
         && request.resource.data.keys().hasOnly(['cats','actualizado','usuario']);

2. **Arranque de administrador (index.html ~2716-2766).** Si no hay ningún admin, cualquier usuario con sesión puede
   auto-asignarse el rol y, para saberlo, la app lista `usuarios_roles` con `where rol == 'admin'`. Para que eso funcione, las reglas
   tendrían que permitir listar roles y crear un rol propio a cualquier usuario autenticado. **Revisa que eso no esté activo hoy:**
   la apiKey de Firebase es pública y, si el inicio de sesión por correo permite registrarse, cualquiera podría obtener acceso.
   La propuesta lo deja cerrado (solo admin lista/gestiona roles) y trae el arranque inicial comentado.

3. **Costo oculto de las reglas.** Cada `get()`/`exists()` del rol en las reglas se cobra como una lectura adicional por operación.
   Un ciclo de sello (1 lectura) cuesta 2. Si crece el uso, la mejora es mover el rol a *custom claims* del token (Admin SDK) y
   leer `request.auth.token.rol` sin consultar documentos.

4. **`registro_operadores`**: la app tolera la negativa de lectura/escritura (devuelve `null`/`false`). La propuesta deja la lectura
   solo para admin; ajústala a tu política actual de «permiso explícito».

## Pruebas (hazlas en Consola → Firestore → Reglas → Simulador, antes de publicar)
| Quién | Operación | Documento | Esperado |
|---|---|---|---|
| editor | set (merge) | planificador_compartido/sello | permitido |
| visor | get | planificador_compartido/sello | permitido |
| visor | set | planificador_compartido/sello | **denegado** |
| editor | set | planificador_compartido/plan_3 | permitido |
| editor | set | planificador_compartido/otro | **denegado** |
| visor | get | registro_cosechadoras/meta | permitido |
| visor | set | registro_cosechadoras/meta | **denegado** |
| editor | create | historial_cambios/x con {email, accion, fecha} | permitido |
| editor | update/delete | historial_cambios/x | **denegado** |
| editor | list | usuarios_roles | **denegado** |
| admin | list | usuarios_roles | permitido |
| sin rol | get | usuarios_roles/su-correo | permitido (cuando no existe, la app muestra «sin rol») |
| sin sesión | cualquier lectura | cualquiera | **denegado** |

Estas reglas NO fueron ejecutadas en el emulador (en este entorno no se puede descargar): valídalas en el Simulador.

## Orden de despliegue
1. Publicar las reglas (o el bloque mínimo del sello).
2. Subir los HTML y archivos nuevos a GitHub.
3. Entrar a index como admin/editor → Ajustes → **Publicar sello de cambios** (una sola vez).
4. Abrir Seguimiento: la pastilla pasa a «Sin cambios · comprobado hh:mm» en los ciclos automáticos.
