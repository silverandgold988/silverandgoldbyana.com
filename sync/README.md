# Sincronización Canva → sitio web

El sitio (`index.html` + `assets/`) no cambia. Lo único que se regenera es
`catalog/manifest.json` y las imágenes en `catalog/<id>/`. La página lee el
manifest al cargar, así que cualquier cambio en Canva aparece solo.

## Instalación en el VPS (una sola vez)

```bash
# 1. Copiar la carpeta completa del sitio al VPS, por ejemplo:
scp -r silver-and-gold-web usuario@VPS:/opt/sga

# 2. Credenciales
cd /opt/sga/sync
cp .env.example .env && nano .env      # Canva client id/secret + FTP GoDaddy

# 3. Autorizar Canva (una sola vez). Si lo corres en el VPS sin navegador,
#    usa un túnel: ssh -L 8765:127.0.0.1:8765 usuario@VPS  y abre la URL en tu Mac.
python3 auth.py

# 4. Prueba
python3 canva_sync.py --force

# 5. Programar cada 6 horas
crontab -e
0 */6 * * * cd /opt/sga/sync && /usr/bin/python3 canva_sync.py >> sync.log 2>&1
```

## Agregar un catálogo nuevo

Edita `sync/config.json` y añade otro bloque con el `canva_design_id`
(el ID que aparece en la URL del diseño, empieza por `D`). Comparte el diseño
con la cuenta que autorizó la integración. La próxima sincronización lo crea.

## Archivos

- `canva_sync.py` — exporta, descarga, regenera manifest, sube por FTP solo lo que cambió.
- `auth.py` — autorización OAuth inicial con Canva.
- `config.json` — catálogos y datos de marca.
- `.state.json`, `.tokens.json` — estado y tokens (no compartir).
