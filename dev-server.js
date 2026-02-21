require('dotenv').config();
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const searchHandler = require('./api/search.js');
const uploadHandler = require('./api/upload.js');
const foldersHandler = require('./api/folders.js');
const signUploadHandler = require('./api/sign-upload.js');
const downloadPdfHandler = require('./api/download-pdf.js');

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // Version endpoint
  if (pathname === '/api/version') {
    try {
      const versionData = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8'));
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(versionData));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Could not read version file' }));
    }
    return;
  }

  // Route to appropriate handler
  if (pathname === '/api/search') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      let parsedBody = null;
      try { parsedBody = raw ? JSON.parse(raw) : null; } catch (e) { parsedBody = null; }

      const query = Object.fromEntries(parsedUrl.searchParams);
      const vreq = {
        method,
        query,
        body: parsedBody,
        headers: req.headers
      };

      const vres = {
        headers: {},
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        setHeader(k, v) { this.headers[k] = v; res.setHeader(k, v); },
        json(obj) { res.setHeader('Content-Type', 'application/json'); res.writeHead(this.statusCode || 200); res.end(JSON.stringify(obj)); },
        end() { res.end(); }
      };

      try {
        await searchHandler(vreq, vres);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

  } else if (pathname === '/api/upload') {
    // Wrap response with necessary methods for upload handler
    const vres = res;
    
    // Ensure status method exists
    if (!vres.status) {
      vres.status = function(code) {
        this.statusCode = code;
        return this;
      };
    }
    
    // Ensure json method exists
    if (!vres.json) {
      vres.json = function(obj) {
        this.setHeader('Content-Type', 'application/json');
        this.writeHead(this.statusCode || 200);
        this.end(JSON.stringify(obj));
      };
    }
    
    // Call handler and catch any errors
    uploadHandler(req, vres).catch(err => {
      console.error('Upload handler error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

  } else if (pathname === '/api/folders') {
    // Wrap response with necessary methods for folders handler
    const vres = res;
    
    // Ensure status method exists
    if (!vres.status) {
      vres.status = function(code) {
        this.statusCode = code;
        return this;
      };
    }
    
    // Ensure json method exists
    if (!vres.json) {
      vres.json = function(obj) {
        this.setHeader('Content-Type', 'application/json');
        this.writeHead(this.statusCode || 200);
        this.end(JSON.stringify(obj));
      };
    }
    
    // Call handler and catch any errors
    foldersHandler(req, vres).catch(err => {
      console.error('Folders handler error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

  } else if (pathname === '/api/sign-upload') {
    // Wrap response with necessary methods for sign-upload handler
    const vres = res;
    
    // Ensure status method exists
    if (!vres.status) {
      vres.status = function(code) {
        this.statusCode = code;
        return this;
      };
    }
    
    // Ensure json method exists
    if (!vres.json) {
      vres.json = function(obj) {
        this.setHeader('Content-Type', 'application/json');
        this.writeHead(this.statusCode || 200);
        this.end(JSON.stringify(obj));
      };
    }
    
    // Call handler and catch any errors
    signUploadHandler(req, vres).catch(err => {
      console.error('Sign upload handler error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

  } else if (pathname === '/api/download-pdf') {
    // Wrap response with necessary methods for download-pdf handler
    const vres = res;
    
    // Call handler and catch any errors
    downloadPdfHandler(req, vres).catch(err => {
      console.error('Download PDF handler error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

  } else if (pathname === '/' || pathname === '/search') {
    // Serve search page
    const filePath = path.join(__dirname, 'squarespace-search.html');
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading search page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });

  } else if (pathname === '/upload' || pathname === '/uploader') {
    // Serve uploader page
    const filePath = path.join(__dirname, 'squarespace-uploader.html');
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading uploader page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });

  } else {
    // Try to serve static files
    const filePath = path.join(__dirname, pathname);
    
    // Security: prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }

      // Determine content type
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.webp': 'image/webp',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.css': 'text/css',
        '.js': 'text/javascript'
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error reading file');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║          Dev Server Started - Available Routes                    ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║ Base URL: http://localhost:${port}`.padEnd(67) + '║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║ PAGES:                                                           ║');
  console.log(`║  • http://localhost:${port}/          → Search Page             ║`);
  console.log(`║  • http://localhost:${port}/search     → Search Page             ║`);
  console.log(`║  • http://localhost:${port}/upload     → Bulk Uploader           ║`);
  console.log(`║  • http://localhost:${port}/uploader   → Bulk Uploader           ║`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║ APIs:                                                            ║');
  console.log(`║  • http://localhost:${port}/api/search       → Search API         ║`);
  console.log(`║  • http://localhost:${port}/api/upload       → Upload API         ║`);
  console.log(`║  • http://localhost:${port}/api/sign-upload  → Sign Upload Token  ║`);
  console.log(`║  • http://localhost:${port}/api/folders      → List Folders       ║`);
  console.log(`║  • http://localhost:${port}/api/version      → Version Info       ║`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║ Health Check:                                                    ║');
  console.log(`║  • http://localhost:${port}/health    → API Status              ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
});
