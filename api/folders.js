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
    const folders = new Set();
    
    // Get root level folders
    console.log('Fetching root folders...');
    const rootFoldersResult = await cloudinary.api.root_folders();
    
    if (rootFoldersResult.folders && Array.isArray(rootFoldersResult.folders)) {
      console.log(`Found ${rootFoldersResult.folders.length} root folders`);
      rootFoldersResult.folders.forEach(folder => {
        folders.add(folder.name);
      });
      
      // For each root folder, get subfolders
      for (const folder of rootFoldersResult.folders) {
        try {
          console.log(`Fetching subfolders for: ${folder.name}`);
          const subFoldersResult = await cloudinary.api.sub_folders(folder.name);
          
          if (subFoldersResult.folders && Array.isArray(subFoldersResult.folders)) {
            // Recursively add subfolders
            const addSubfolders = (folderPath, folderList) => {
              folderList.forEach(subfolder => {
                const fullPath = folderPath ? `${folderPath}/${subfolder.name}` : subfolder.name;
                folders.add(fullPath);
              });
            };
            
            addSubfolders(folder.name, subFoldersResult.folders);
          }
        } catch (subError) {
          console.warn(`Could not fetch subfolders for ${folder.name}:`, subError.message);
        }
      }
    } else {
      console.log('No root folders found, trying to extract from resources');
      // Fallback: try to extract folders from resources
      const resources = await cloudinary.api.resources({
        type: 'upload',
        max_results: 500,
        resource_type: 'image'
      });
      
      if (resources.resources && Array.isArray(resources.resources)) {
        resources.resources.forEach(resource => {
          if (resource.folder) {
            folders.add(resource.folder);
            // Also add parent folders
            const folderParts = resource.folder.split('/');
            for (let i = 1; i < folderParts.length; i++) {
              folders.add(folderParts.slice(0, i).join('/'));
            }
          }
        });
      }
    }

    // Convert Set to sorted array
    const folderArray = Array.from(folders)
      .sort()
      .map(folder => ({
        path: folder,
        displayName: folder.split('/').pop() || folder
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    console.log(`Total folders found: ${folderArray.length}`, folderArray.map(f => f.path));
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
    
    // Format response with folder paths
    const folderPaths = folders.map(f => f.path);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: true,
      folders: folderPaths
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
