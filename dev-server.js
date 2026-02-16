require('dotenv').config();
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const searchHandler = require('./api/search.js');
const uploadHandler = require('./api/upload.js');
const foldersHandler = require('./api/folders.js');

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
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
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
  console.log(`║  • http://localhost:${port}/api/search  → Search API             ║`);
  console.log(`║  • http://localhost:${port}/api/upload  → Upload API             ║`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║ Health Check:                                                    ║');
  console.log(`║  • http://localhost:${port}/health    → API Status              ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
});
