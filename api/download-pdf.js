/**
 * Proxy endpoint for downloading PDFs from Cloudinary
 * Bypasses CORS issues by fetching on the server side
 */

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

    const { url, fileName } = body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log('PDF download request for:', url);

    // Fetch the PDF from Cloudinary
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`Cloudinary response error: ${response.status}`);
      return res.status(response.status).json({ 
        error: `Failed to fetch PDF: ${response.status} ${response.statusText}` 
      });
    }

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName || 'document.pdf')}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Stream the PDF to the client
    const buffer = await response.buffer();
    res.send(buffer);

  } catch (error) {
    console.error('PDF download error:', error);
    const errorMsg = error.message || 'Internal server error';
    
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    }
  }
};
