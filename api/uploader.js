/**
 * Vercel serverless function: /api/uploader
 * Serves the image uploader HTML interface
 */

const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // API Key authentication
  const apiKey = req.query.key || req.headers['x-api-key'];
  const validKey = process.env.UPLOADER_API_KEY;

  if (!validKey) {
    console.error('UPLOADER_API_KEY environment variable not set');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server configuration error' }));
    return;
  }

  if (!apiKey || apiKey !== validKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }));
    return;
  }

  try {
    // Read uploader HTML from project root
    const htmlPath = path.join(process.cwd(), 'squarespace-uploader.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(html);
  } catch (error) {
    console.error('Error serving uploader:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to load uploader interface' }));
  }
};
