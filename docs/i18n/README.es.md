# Thunderbird AI Bridge

[English / lista completa de idiomas](../../README.md)

## ¿Qué es?

Thunderbird AI Bridge es un puente local entre Thunderbird y agentes de IA, herramientas CLI, scripts y aplicaciones personalizadas. La extensión realiza operaciones en el buzón y un programa local se comunica con ella mediante un pequeño protocolo HTTP en `127.0.0.1`.

**SuperCLI no es obligatorio.** El primer host se creó para SuperCLI, pero cualquier programa puede usar la extensión si implementa el protocolo descrito en [docs/PROTOCOL.md](../PROTOCOL.md).

## Funciones

- listar cuentas y carpetas,
- crear, renombrar y eliminar carpetas,
- buscar por remitente, destinatario/dirección, asunto, texto y fecha,
- leer mensajes sin cambiar intencionadamente su estado de leído,
- paginar mensajes largos,
- listar y transferir archivos adjuntos para modelos con visión o procesadores de documentos,
- mover mensajes, enviarlos a la Papelera y restaurarlos,
- eliminación permanente con verificación IMAP,
- Empty Trash/EXPUNGE nativo de Thunderbird,
- importar mensajes Outlook `.msg` convertidos a `.eml`,
- operaciones masivas por lotes limitados con tokens de continuación.

## Seguridad

Las operaciones destructivas incluyen protecciones adicionales. Las acciones sensibles requieren `confirm: true`, la eliminación permanente se limita a la Papelera y las carpetas del sistema/root están protegidas. El host también debe pedir confirmación clara al usuario.

El diseño es local. No expongas directamente el host del bridge a una LAN o a Internet.

## Compilar

Requiere Thunderbird 128 o posterior.

```bash
python scripts/build_xpi.py
npm test
```

El XPI se genera en `dist/thunderbird-ai-bridge.xpi` y puede instalarse manualmente desde el administrador de complementos de Thunderbird.

Estado: experimental (`0.9.18`). El protocolo puede cambiar antes de `1.0`.

Licencia MIT. Proyecto independiente, no afiliado ni respaldado por Mozilla o Thunderbird.
