import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Dev-only plugin that proxies /api/download-shift requests to Google Sheets,
 * replicating the Vercel serverless function so Sync Sheets works locally.
 */
function devShiftDownloadProxy(): Plugin {
  return {
    name: 'dev-shift-download-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const reqUrl = req.url || ''
        if (!reqUrl.startsWith('/api/download-shift')) {
          next()
          return
        }
        const url = new URL(reqUrl, 'http://localhost')
        const sourceUrl = (url.searchParams.get('url') || '').trim()

        if (!sourceUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing url parameter' }))
          return
        }

        let hostname: string
        try {
          hostname = new URL(sourceUrl).hostname
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid url' }))
          return
        }

        if (hostname !== 'docs.google.com' && hostname !== 'drive.google.com') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Only Google hosts allowed' }))
          return
        }

        // Build export URL
        let downloadUrl = sourceUrl
        const spreadsheetId = sourceUrl.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1]
        if (spreadsheetId) {
          const gid = sourceUrl.match(/[?&]gid=(\d+)/)?.[1]
          downloadUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx${gid ? `&gid=${gid}` : ''}`
        } else {
          const driveFileId =
            sourceUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/)?.[1] ||
            sourceUrl.match(/[?&]id=([a-zA-Z0-9-_]+)/)?.[1]
          if (driveFileId) {
            downloadUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`
          }
        }

        try {
          const response = await fetch(downloadUrl, {
            redirect: 'follow',
            headers: { 'User-Agent': 'time-attendance-app-shift-sync' },
          })

          if (!response.ok) {
            res.writeHead(response.status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: `Google download failed: ${response.status}` }))
            return
          }

          const contentType = response.headers.get('content-type') || 'application/octet-stream'
          const arrayBuffer = await response.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': buffer.length,
            'Cache-Control': 'no-store',
          })
          res.end(buffer)
        } catch (err: unknown) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Download failed' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devShiftDownloadProxy()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    chunkSizeWarningLimit: 1500,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react/')) {
              return 'vendor-react';
            }
            if (id.includes('recharts')) {
              return 'vendor-charts';
            }
            if (id.includes('xlsx') || id.includes('jspdf')) {
              return 'vendor-utils';
            }
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'recharts'],
  },
  esbuild: {
    legalComments: 'none',
  },
})
