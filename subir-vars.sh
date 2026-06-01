#!/bin/bash
# Script que sube todas las variables de .env.local a Vercel automáticamente.
# Uso: bash subir-vars.sh

set +e  # no parar si una variable ya existe

echo "🚀 Subiendo variables a Vercel..."
echo ""

while IFS= read -r line || [ -n "$line" ]; do
  # Saltar comentarios y líneas vacías
  if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then continue; fi
  # Solo procesar líneas con KEY=valor
  if [[ ! "$line" =~ = ]]; then continue; fi

  key="${line%%=*}"
  value="${line#*=}"
  key=$(echo "$key" | xargs)  # trim espacios
  # Quitar comillas dobles si las tiene
  if [[ "$value" =~ ^\".*\"$ ]]; then
    value="${value#\"}"
    value="${value%\"}"
  fi

  echo "→ $key"
  for env in production preview development; do
    npx --yes vercel env rm "$key" "$env" --yes >/dev/null 2>&1
    printf '%s' "$value" | npx --yes vercel env add "$key" "$env" >/dev/null 2>&1
  done
done < .env.local

# APP_BASE_URL — es la nueva, no está en .env.local
echo "→ APP_BASE_URL"
for env in production preview development; do
  npx --yes vercel env rm APP_BASE_URL "$env" --yes >/dev/null 2>&1
  printf '%s' "https://recurrentess.vercel.app" | npx --yes vercel env add APP_BASE_URL "$env" >/dev/null 2>&1
done

echo ""
echo "✅ Listo. Ahora corré: npx vercel deploy --prod"
