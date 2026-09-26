#!/usr/bin/env bash
# ¿Hace falta reconstruir y desplegar este commit?
#
# Vercel lo corre antes de cada build (Project Settings → Git → Ignored Build
# Step → "Run my Bash script" → bash scripts/vercel-ignore-build.sh).
#   exit 1 = construí   ·   exit 0 = saltealo
#
# Por qué existe (26-sept-2026): el Build CPU eran 57 horas en un mes, USD 11,94
# de la factura. Cada push a main reconstruía todo, incluidos los commits que
# solo tocan documentación o tests, que no cambian nada de lo que se sirve.
#
# Regla conservadora a propósito: ante la duda, CONSTRUYE. Un build de más
# cuesta centavos; un deploy que no salió cuando tenía que salir cuesta una
# venta. Solo se saltea cuando TODOS los archivos del rango son de la lista
# segura.
set -euo pipefail

# Rango de commits de este deploy. Sin commit previo (primer deploy, o un push
# forzado) no hay con qué comparar: se construye.
BEFORE="${VERCEL_GIT_PREVIOUS_SHA:-}"
CURRENT="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
if [ -z "$BEFORE" ] || ! git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
  echo "Sin commit anterior con el que comparar: construyo."
  exit 1
fi

CHANGED="$(git diff --name-only "$BEFORE" "$CURRENT" || true)"
if [ -z "$CHANGED" ]; then
  echo "Sin archivos cambiados: construyo por las dudas."
  exit 1
fi

# Lo único que NO se despliega: documentación, tests y config de editor/CI.
# Todo lo demás (api/, src/, shared/, public/, vercel.json, package*.json,
# firestore.*, demos/…) construye.
SEGUROS='^(.*\.md$|docs/|tests/|\.github/|\.vscode/|\.claude/|\.gitignore$|\.editorconfig$|TAREAS_THIAGO\.md$|WHATSAPP\.md$)'

RELEVANTES="$(echo "$CHANGED" | grep -Ev "$SEGUROS" || true)"
if [ -z "$RELEVANTES" ]; then
  echo "Solo documentación y tests en este rango: salteo el build."
  echo "$CHANGED" | sed 's/^/  · /'
  exit 0
fi

echo "Hay cambios que se despliegan: construyo."
echo "$RELEVANTES" | sed 's/^/  · /'
exit 1
