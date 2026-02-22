/**
 * Proxy endpoint for downloading PDFs from Cloudinary
 * Constructs a permanent CDN URL from public_id to avoid 401 errors with secure_url
 */

const https = require('https');

// Allowed origins for referrer validation
const ALLOWED_ORIGINS = [
  'https://www.sigmasigma.org',
  'https://sigmasigma.org',
  'http://localhost',
  'http://localhost:3000'
];

// Validate request origin
function isAllowedOrigin(req) {
  const referer = req.headers.referer || '';
  const origin = req.headers.origin || '';
  
  // Check if referer starts with any allowed origin
  const refererAllowed = ALLOWED_ORIGINS.some(allowed => referer.startsWith(allowed));
  const originAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed);
  
  return refererAllowed || originAllowed;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.writeHead(200);
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Validate origin
    if (!isAllowedOrigin(req)) {
      return res.status(403).json({ error: 'Access denied - invalid origin' });
    }

    // API key authentication
    const apiKey = req.query.key || req.headers['x-api-key'];
    const validKey = process.env.UPLOADER_API_KEY;

    if (!validKey) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!apiKey || apiKey !== validKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }

    // Parse request body
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk.toString(); });
      req.on('error', reject);
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(new Error(`Invalid JSON: ${e.message}`));
        }
      });
    });

    const { cloudName, version, publicId, fileName } = body;

    if (!cloudName || !publicId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'cloudName and publicId are required' }));
    }

    // Construct permanent CDN URL with version number (version is required for folder-based PDFs)
    const url = version 
      ? `https://res.cloudinary.com/${cloudName}/image/upload/${version}/${publicId}`
      : `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`;
    
    console.log('PDF download request - cloudName:', cloudName, 'version:', version, 'publicId:', publicId);
    console.log('Full URL:', url);

    // Fetch the PDF from Cloudinary using https module
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/pdf',
          'Referer': 'https://cloudinary.com/',
          'Accept-Encoding': 'gzip, deflate'
        }
      };
      
      https.get(url, options, (response) => {
        if (response.statusCode !== 200) {
          console.error(`Cloudinary response error: ${response.statusCode} - ${response.statusMessage}`);
          console.error('Response headers:', response.headers);
          res.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Failed to fetch PDF: ${response.statusCode} ${response.statusMessage}` }));
          resolve();
          return;
        }

        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName || 'document.pdf')}"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.writeHead(200);

        // Pipe the PDF stream directly to the client
        response.pipe(res);
        
        response.on('error', (err) => {
          console.error('Stream error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
          }
          res.end();
          reject(err);
        });

        response.on('end', () => {
          console.log('PDF download completed');
          resolve();
        });

      }).on('error', (error) => {
        console.error('HTTPS request error:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message || 'Internal server error' }));
        }
        reject(error);
      });
    });

  } catch (error) {
    console.error('PDF download error:', error);
    const errorMsg = error.message || 'Internal server error';
    
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: errorMsg }));
    }
  }
};


