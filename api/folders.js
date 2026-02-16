/**
 * Vercel serverless function: /api/folders
 * Fetches available folders from Cloudinary Media Library
 */

const cloudinary = require('cloudinary').v2;

// Get list of folders from Cloudinary
async function getFoldersFromCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Missing Cloudinary environment variables');
  }

  // Configure SDK
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret
  });

  try {
    // Get root level resources to find all folders
    const result = await cloudinary.api.resources({
      type: 'upload',
      max_results: 500,
      resource_type: 'image'
    });

    // Extract unique folder paths from resources
    const folders = new Set();
    
    if (result.resources && Array.isArray(result.resources)) {
      result.resources.forEach(resource => {
        if (resource.folder) {
          // Add the folder and any parent folders
          const folderParts = resource.folder.split('/');
          for (let i = 1; i <= folderParts.length; i++) {
            folders.add(folderParts.slice(0, i).join('/'));
          }
        }
      });
    }

    // Convert Set to sorted array, add root folder
    const folderArray = [''].concat(Array.from(folders).sort());
    
    return folderArray;
  } catch (error) {
    console.error('Error fetching folders from Cloudinary:', error.message);
    throw error;
  }
}

// Main handler
module.exports = async (req, res) => {
  console.log('=== Folders Request Started ===');
  console.log('Method:', req.method);

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

  try {
    const folders = await getFoldersFromCloudinary();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: true,
      folders: folders
    }));
  } catch (error) {
    console.error('Error:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: error.message || 'Failed to fetch folders',
      folders: [''] // Return root folder as fallback
    }));
  }
};
