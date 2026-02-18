/**
 * Proxy endpoint for downloading PDFs from Cloudinary
 * Constructs a permanent CDN URL from public_id to avoid 401 errors with secure_url
 */

const https = require('https');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
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

    const { cloudName, publicId, fileName } = body;

    if (!cloudName || !publicId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'cloudName and publicId are required' }));
    }

    // Construct permanent CDN URL (not time-limited like secure_url)
    const url = `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`;
    
    console.log('PDF download request for:', url);

    // Fetch the PDF from Cloudinary using https module
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          console.error(`Cloudinary response error: ${response.statusCode}`);
          res.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Failed to fetch PDF: ${response.statusCode}` }));
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


