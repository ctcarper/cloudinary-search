/**
 * Generate a signed upload token for direct browser-to-Cloudinary uploads
 * This allows large files to bypass the serverless function payload limit
 */

module.exports = async (req, res) => {
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

    const { folder, name, isAudio } = body;

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret
    });

    // Build upload parameters
    const uploadParams = {
      public_id: `tap_${Date.now()}_${(name || 'upload').replace(/\s+/g, '_')}`,
      context: `name=${name || ''}`,
      tags: [name].filter(Boolean),
      resource_type: 'video'
    };

    // Add audio tag if it's an audio file
    if (isAudio) {
      uploadParams.tags.push('audio');
    }

    // Add folder if specified
    if (folder) {
      uploadParams.folder = folder;
    }

    // Generate signature - api_sign_request expects (params_obj, secret)
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      uploadParams,
      apiSecret
    );

    const responseObj = {
      success: true,
      signature,
      timestamp,
      public_id: uploadParams.public_id,
      cloudName,
      apiKey,
      uploadParams
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
