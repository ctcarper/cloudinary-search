/**
 * Generate a signed upload token for direct browser-to-Cloudinary uploads
 * This allows large files to bypass the serverless function payload limit
 */

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
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

  try {
    if (req.method !== 'POST') {
      if (res.status) {
        return res.status(405).json({ error: 'Method not allowed' });
      } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Method not allowed' }));
      }
    }

    const cloudinary = require('cloudinary').v2;
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      const missing = [];
      if (!cloudName) missing.push('CLOUDINARY_CLOUD_NAME');
      if (!apiKey) missing.push('CLOUDINARY_API_KEY');
      if (!apiSecret) missing.push('CLOUDINARY_API_SECRET');
      
      const errorObj = { error: `Missing Cloudinary credentials: ${missing.join(', ')}` };
      if (res.status) {
        return res.status(500).json(errorObj);
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(errorObj));
      }
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

    const { folder, name, isAudio, isPDF } = body;

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret
    });

    // Build upload parameters for signing
    const timestamp = Math.floor(Date.now() / 1000);
    const public_id = `tap_${Date.now()}_${(name || 'upload').replace(/\s+/g, '_')}`;
    
    // Determine resource type based on file type
    // Note: PDFs are uploaded as 'image' type per Cloudinary documentation
    let resourceType = 'video'; // default for videos and audio
    if (isPDF) {
      resourceType = 'image'; // PDFs are image assets in Cloudinary
    }
    
    // Parameters that will be signed - must match what gets sent to Cloudinary
    const paramsToSign = {
      public_id,
      resource_type: resourceType,
      timestamp
    };

    // Add context metadata
    if (name) {
      paramsToSign.context = `name=${name}`;
    }

    // Add tags
    const tagsList = [];
    if (name) {
      tagsList.push(name);
    }
    if (isAudio) {
      tagsList.push('audio');
    }
    if (isPDF) {
      tagsList.push('pdf');
    }
    if (tagsList.length > 0) {
      paramsToSign.tags = tagsList.join(',');
    }

    // Add folder if specified
    if (folder) {
      paramsToSign.folder = folder;
    }

    console.log('Params to sign:', paramsToSign);

    // Generate signature - must only include specific parameters
    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      apiSecret
    );

    console.log('Generated signature:', signature);

    const responseObj = {
      success: true,
      signature,
      timestamp,
      public_id,
      resource_type: resourceType,
      cloudName,
      apiKey,
      context: paramsToSign.context || null,
      tags: tagsList,
      folder: folder || null
    };

    if (res.status) {
      return res.status(200).json(responseObj);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(responseObj));
    }

  } catch (error) {
    console.error('Sign upload endpoint error:', error);
    const errorObj = { error: error.message || 'Internal server error' };
    if (res.status) {
      return res.status(500).json(errorObj);
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(errorObj));
    }
  }
};
