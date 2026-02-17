/**
 * Generate a signed upload token for direct browser-to-Cloudinary uploads
 * This allows large files to bypass the serverless function payload limit
 */

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
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
      res.status(500).json({
        error: `Missing Cloudinary credentials: ${missing.join(', ')}`
      });
      return;
    }

    // Parse request body
    let body = '';
    
    return new Promise((resolve) => {
      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const { folder, name, isAudio } = data;

          cloudinary.config({
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret
          });

          // Build upload parameters
          const uploadParams = {
            public_id: `tap_${Date.now()}_${(name || 'upload').replace(/\s+/g, '_')}`,
            context: `name=${name || ''}`,
            tags: [name].filter(Boolean)
          };

          // Add audio tag if it's an audio file
          if (isAudio) {
            uploadParams.tags.push('audio');
            uploadParams.resource_type = 'video';
          } else {
            uploadParams.resource_type = 'video';
          }

          // Add folder if specified
          if (folder) {
            uploadParams.folder = folder;
          }

          // Generate signature
          const timestamp = Math.floor(Date.now() / 1000);
          const signature = cloudinary.utils.api_sign_request(
            uploadParams,
            apiSecret
          );

          res.status(200).json({
            success: true,
            signature,
            timestamp,
            public_id: uploadParams.public_id,
            cloudName,
            apiKey,
            uploadParams
          });
          resolve();
        } catch (error) {
          console.error('Sign upload error:', error);
          res.status(500).json({
            error: `Failed to generate signature: ${error.message}`
          });
          resolve();
        }
      });
    });

  } catch (error) {
    console.error('Sign upload endpoint error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
