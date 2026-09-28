# VIGÍA · Contrato de la API v1

En la edición local la API vive en el navegador (`src/js/api.js`, clase `V.Api`). Cada método recibe un **token de sesión**; la organización y el rol se toman de la sesión, nunca de parámetros. La fase 2 expone el mismo contrato por HTTP bajo `/api/v1`. Aquí se documenta cada operación con su equivalente REST.

## Errores

Todas las operaciones lanzan `VigiaError` con forma JSON:

```json
{ "error": { "codigo": "NO_ENCONTRADO", "mensaje": "Recurso no encontrado en su organización.", "detalle": null } }
```

| Código | HTTP (fase 2) | Cuándo |
|---|---|---|
| NO_AUTENTICADO / SESION_EXPIRADA | 401 | token inválido o vencido |
| CREDENCIALES | 401 | correo o contraseña incorrectos |
| PROHIBIDO | 403 | el rol no tiene el permiso |
| NO_ENCONTRADO | 404 | no existe **o pertenece a otra organización** (no se revela) |
| VALIDACION / FORMATO / INTERVALO_INVALIDO | 422 | datos inválidos, archivo que no es video |
| LIMITE | 413/429 | tamaño, ventana > 24 h, clip > 600 s, intentos |
| CONFLICTO | 409 | archivo duplicado (mismo SHA-256), original inmutable |
| PROTEGIDO | 409 | evidencia vinculada a expediente protegido |
| CONFIRMACION | 428 | acción sensible sin confirmación explícita |
| NO_SOPORTADO / DECODIFICACION | 415 | RTSP en navegador, códec no decodificable |

## Sesión

| Método local | REST | Notas |
|---|---|---|
| `login(email, password, orgId?)` | `POST /api/v1/sesiones` | Si el usuario tiene varias organizaciones y no se indica, responde `{requiereOrganizacion:true, orgs:[…]}` |
| `logout(token)` | `DELETE /api/v1/sesiones/actual` | |
| `session(token)` | `GET /api/v1/sesiones/actual` | `{userId,email,org,orgNombre,rol,exp}` |

```json
POST /api/v1/sesiones  {"email":"admin@norte.demo","password":"…"}
→ 201 {"token":"…","session":{"org":"org_01…","rol":"admin","exp":1790000000000}}
```

## Cámaras y grupos

| Método | REST | Permiso |
|---|---|---|
| `listCameras(t)` | `GET /api/v1/camaras` | camaras.ver |
| `getCamera(t,id)` | `GET /api/v1/camaras/{id}` | camaras.ver |
| `saveCamera(t,{id?,nombre,tipo,tz,rtspUrl,sede,zona,ubicacion,mascaras})` | `POST/PUT /api/v1/camaras` | camaras.gestionar |
| `listGroups(t)` / `saveGroup(t,{nombre,cameraIds})` | `/api/v1/grupos` | ver / gestionar |

`tipo`: `archivo | webcam | rtsp`. La contraseña de una URL RTSP se enmascara antes de guardar. `mascaras`: rectángulos en fracciones `[0,1]` excluidos del detector de movimiento.

## Grabaciones y trabajos

| Método | REST | Permiso |
|---|---|---|
| `importRecording(t, cameraId, file, {fuenteDeclarada, horaInicioDeclarada, ia})` | `POST /api/v1/camaras/{id}/grabaciones` (multipart) | grabaciones.cargar |
| `listRecordings(t, cameraId?)` / `getRecording(t,id)` | `GET /api/v1/grabaciones` | camaras.ver |
| `verifyRecording(t,id)` | `POST /api/v1/grabaciones/{id}/verificacion` | medios.ver |
| `deleteRecording(t,id)` | `DELETE /api/v1/grabaciones/{id}` | grabaciones.eliminar; 409 PROTEGIDO si hay expediente |
| `listJobs(t)` | `GET /api/v1/trabajos` | — |
| `requeueAnalysis(t, recId, {ia})` | `POST /api/v1/grabaciones/{id}/analisis` | grabaciones.cargar |

```json
→ 201 {"recording":{"id":"grb_01…","sha256":"a7d63eb8…","horaInicioFuente":"desconocida","estado":"pendiente"},
       "job":{"id":"job_01…","estado":"pendiente","progreso":0}}
```

## Fotogramas, detecciones, hallazgos, búsqueda

| Método | REST | Permiso |
|---|---|---|
| `listFrames(t, recId, a?, b?)` | `GET /api/v1/grabaciones/{id}/fotogramas?desde=&hasta=` | medios.ver |
| `listFindings(t, {cameraId, estado, recordingId})` | `GET /api/v1/hallazgos` | camaras.ver |
| `reviewFinding(t, id, estado, nota)` | `PATCH /api/v1/hallazgos/{id}` | hallazgos.revisar; `confirmado` exige incidentes.confirmar |
| `searchEvents(t, {cameraIds, ventana, clases, limit, offset})` | `POST /api/v1/busquedas` | camaras.ver |

`ventana`: `{modo:"posicion",a,b}` (segundos del archivo) · `{modo:"absoluta",a,b}` (ms UTC) · `{modo:"ultimos",segundos}` · `{modo:"todo"}`. Máximo 24 h.

```json
POST /api/v1/busquedas {"cameraIds":["cam_01…"],"ventana":{"modo":"posicion","a":60,"b":180},"clases":["person","car"]}
→ 200 {"total":1,"offset":0,"limit":50,
  "items":[{"id":"hal_01…","clase":"person","inicio":86,"fin":106,"score":0.88,"motor":"coco-ssd-v2","estado":"sugerido","frameId":"frm_01…"}],
  "cobertura":[{"recordingId":"grb_01…","a":60,"b":180,"recortada":false,"indexado":true,"motores":["movimiento-v1","coco-ssd-v2"],"soportaClase":true}]}
```

## Medios (autorizados, con caducidad)

| Método | REST | Permiso |
|---|---|---|
| `mediaURL(t, kind, id, 'ver'|'descargar')` | `GET /api/v1/medios/{kind}/{id}?motivo=` → URL firmada 10 min | medios.ver / evidencia.descargar |
| `saveDerivative(t, recId, blob, info)` | interno de clips/fotogramas | clips.crear |
| `getDerivative` / `listDerivatives` / `verifyDerivative` | `/api/v1/derivados` | medios.ver |

`kind`: `original | derivado | fotograma | alerta`. Ver y descargar originales/derivados queda en auditoría.

Clips (`V.media.makeClip`) → `POST /api/v1/grabaciones/{id}/clips {"inicio":70,"fin":130,"hallazgoId":"hal_…"}`:

```json
→ 201 {"id":"clip_01…","solicitado":{"inicio":71,"fin":130},"inicio":70.0,"fin":130.0,
  "metodo":"mp4cut v1 · copia de flujo","transformacion":"ninguna (copia de flujo sin recodificar)",
  "comandoEquivalente":"ffmpeg -ss 70.000 -i <original> -t 60.000 -c copy …",
  "sha256":"02007c04…","origenSha256":"a7d63eb8…"}
```

## Chat

| Método | REST |
|---|---|
| `createChat` / `listChats` / `getChat` / `listMessages` / `addMessage` / `saveChatState` | `/api/v1/chats`, `/api/v1/chats/{id}/mensajes` |
| `V.chat.ejecutar(api, texto, {token, estado, seleccion, planEditado})` | `POST /api/v1/chats/{id}/mensajes {"texto":"…","plan":…}` |

Respuesta: `{texto, plan, tarjetas[], estado}`. `plan` = interpretación editable (`intent, camaras, ventana, clases, clip, supuestos, faltantes, confianza`). Tipos de tarjeta: `fotogramas, fotogramas_vivo, vivo, vivo_no, hallazgos, clip, caso, informe, indicadores, camaras, regla_preview, aclaracion, pendiente, sin_cobertura, ayuda`.

## Expedientes e informes

| Método | REST | Permiso |
|---|---|---|
| `createCase`, `listCases`, `getCase`, `updateCase` | `/api/v1/expedientes` | expedientes.crear / ver; `aprobado` exige informes.aprobar |
| `addEvidence(t, caseId, {tipo, refId, clasificacion, nota})` | `POST /api/v1/expedientes/{id}/evidencias` | expedientes.crear |
| `addNote(t, caseId, texto, 'nota'|'hipotesis')` | `POST /api/v1/expedientes/{id}/notas` | expedientes.crear |
| `V.reports.generar` / `V.reports.pdf` + `saveReport` | `POST /api/v1/expedientes/{id}/informes?formato=html|pdf` | expedientes.crear |

`clasificacion`: `hipotesis | sugerido_ia | revisado | confirmado`.

## Reglas, alertas, políticas, indicadores, auditoría

| Método | REST | Permiso |
|---|---|---|
| `createRule(t,{cameraId, clase, duracionMin, destinatario, horario?, prioridad?, confirmado:true})` | `POST /api/v1/reglas` | reglas.crear; sin `confirmado` → 428. `horario = {dias:[0..6], desde:'HH:MM', hasta:'HH:MM'}` (zona de la cámara; admite cruzar medianoche); con horario la vigencia llega a 30 días |
| `listRules`, `listAlerts` | `GET /api/v1/reglas`, `GET /api/v1/alarmas` | camaras.ver |
| `cancelRule` | `DELETE /api/v1/reglas/{id}` | reglas.crear |
| `ackAlert` (= `updateAlert` «reconocer») | `POST /api/v1/alarmas/{id}/reconocimiento` | alarmas.gestionar |
| `getPolicy`, `savePolicy`, `retentionPreview` | `/api/v1/politicas/retencion` | admin.politicas |

## Central de alarmas, plano, apariencia y paquete de evidencia (v1.1)

| Método | REST | Permiso |
|---|---|---|
| `updateAlert(t, id, {accion:'reconocer'\|'asignar'\|'paso'\|'nota'\|'cerrar'\|'reabrir', …})` | `POST /api/v1/alarmas/{id}/acciones` | alarmas.gestionar (reabrir: incidentes.confirmar). Cerrar exige `resolucion` ∈ real/falsa/prueba/duplicada; «real» exige nota. Reconocer dos veces → 409 |
| `alarmFromFinding(t, findingId, prioridad?)` | `POST /api/v1/hallazgos/{id}/alarma` | alarmas.gestionar; no duplica una alarma abierta |
| `alarmStats(t, desdeMs?)` | `GET /api/v1/alarmas/indicadores` | indicadores.ver → `{total, abiertas, vencidas, mttaS, mttrS, cumplimientoSLA, tasaFalsas, porEstado, porPrioridad}` |
| `getPlan(t)` / `savePlan(t,{nombre, imagen?, camaras:{camId:{x,y,ang,fov,alcance}}})` | `GET/PUT /api/v1/plano` | camaras.ver / camaras.gestionar. Imagen sólo PNG/JPEG/WebP ≤ 3 MB; cámaras de otra organización se ignoran |
| `searchAppearance(t,{findingId\|firma, umbral 0.5–0.99, cameraIds?, limit})` | `POST /api/v1/busquedas/apariencia` | medios.ver. Sin firma → `SIN_FIRMA` |
| `casePackage(t, caseId, {incluirOriginales, privacidad})` | `GET /api/v1/expedientes/{id}/paquete` | evidencia.descargar; auditado |
| `privacyBoxes(t, recordingId, clases?)` | `GET /api/v1/grabaciones/{id}/privacidad` | medios.ver |

Prioridad y SLA de reconocimiento por defecto: crítica 60 s (humo) · alta 2 min (intrusión, manipulación, objeto abandonado) · media 5 min · baja 15 min. Cada alarma copia el procedimiento (SOP) de su tipo y guarda un historial de acciones.
| `metrics(t)` | `GET /api/v1/indicadores` | indicadores.ver |
| `auditLog(t,{limit})`, `verifyAudit(t)` | `GET /api/v1/auditoria`, `POST /api/v1/auditoria/verificacion` | auditoria.ver |
| `listMembers`, `createUser` | `/api/v1/miembros` | admin.usuarios |

## Paginación y límites

`limit` (1–200, por defecto 50) y `offset` en búsquedas; auditoría hasta 1000. Límites configurables en `vigia.config.js`: `maxUploadMB` (2048), `maxIntervaloConsultaH` (24), `maxClipS` (600), `sesionHoras` (8), `urlTTLmin` (10).
