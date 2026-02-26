cat > ~/deploy/radioesperanza-backend/rebuild-strapi.sh << 'EOF'
#!/bin/bash
cd ~/deploy/radioesperanza-backend

# Cargar Node.js de cPanel
source /home/radioesp/nodevenv/radioesperanza-backend/22/bin/activate 2>/dev/null || true
export PATH=$HOME/nodevenv/radioesperanza-backend/22/bin:$PATH

echo "Node: $(node -v)"
echo "📥 Installing dependencies..."
npm install --omit=dev

echo "🏗️ Building Strapi..."
NODE_ENV=production npm run build

echo "🔄 Restarting app..."
mkdir -p tmp
touch tmp/restart.txt

echo "✅ Done!"
EOF

chmod +x ~/deploy/radioesperanza-backend/rebuild-strapi.sh