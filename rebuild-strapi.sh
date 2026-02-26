# Crear el script una sola vez
echo '#!/bin/bash
cd ~/radioesperanza-backend
npm install --omit=dev
NODE_ENV=production npm run build
mkdir -p tmp
touch tmp/restart.txt
echo "✅ Strapi rebuilt and restarted!"' > ~/rebuild-strapi.sh

chmod +x ~/rebuild-strapi.sh