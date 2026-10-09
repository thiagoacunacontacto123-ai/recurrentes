# Presentaciones para clientes

Una presentación de venta en UN link propio, sin login ni permisos:
`recurrentesapp.com/presentaciones/<marca>.html`. La primera es G4U (9-oct-2026).

Se arma desde un deck de Slides (el artifact), que es donde se edita:

    node presentaciones/armar.mjs <carpeta-del-deck> public/presentaciones/<marca>.html

Qué hace el script:
- **Saca las `<aside>`**, que son las notas de orador. ESO NO PUEDE VIAJAR AL CLIENTE.
- Reemplaza los tags propios del editor (`x-icon`, `x-shape`) por SVG y divs comunes,
  porque en un navegador no existen.
- Mete cada slide de 1920×1080 en una caja 16:9 que escala al ancho de la pantalla, y
  si una slide quedó con más contenido del que entra en 1080 le aplica una segunda
  escala interna para que **nada se corte** (el editor del artifact hace lo mismo).
- `noindex`: es para mandar por link, no para que lo encuentre Google.

Las dos versiones -el artifact y la página- salen del MISMO deck, así que después de
editar slides hay que publicar en los dos lados.
