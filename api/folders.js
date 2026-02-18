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
    
    // Try to get root level folders
    console.log('Fetching root folders...');
    let rootFoldersResult = null;
    try {
      rootFoldersResult = await cloudinary.api.root_folders();
      
      if (rootFoldersResult.folders && Array.isArray(rootFoldersResult.folders)) {
        console.log(`Found ${rootFoldersResult.folders.length} root folders`);
        rootFoldersResult.folders.forEach(folder => {
          folders.add(folder.name);
        });
        
        // For each root folder, get subfolders (recursive)
        const getSubfolders = async (folderPath) => {
          try {
            const subFoldersResult = await cloudinary.api.sub_folders(folderPath);
            
            if (subFoldersResult.folders && Array.isArray(subFoldersResult.folders)) {
              for (const subfolder of subFoldersResult.folders) {
                const fullPath = `${folderPath}/${subfolder.name}`;
                folders.add(fullPath);
                // Recursively get nested subfolders
                await getSubfolders(fullPath);
              }
            }
          } catch (subError) {
            console.warn(`Could not fetch subfolders for ${folderPath}:`, subError.message);
          }
        };
        
        // Get subfolders for each root folder
        for (const folder of rootFoldersResult.folders) {
          await getSubfolders(folder.name);
        }
      }
    } catch (rootError) {
      console.warn('Could not fetch root folders:', rootError.message);
    }

    // Fallback/Supplement: Extract folders from all resources (images, videos, audio)
    console.log('Extracting folders from resources...');
    const resourceTypes = ['image', 'video', 'raw'];
    
    for (const resourceType of resourceTypes) {
      let nextCursor = null;
      let pageCount = 0;
      
      try {
        do {
          pageCount++;
          console.log(`Fetching ${resourceType}s page ${pageCount}...`);
          
          const resourcesParams = {
            type: 'upload',
            max_results: 500,
            resource_type: resourceType
          };
          
          if (nextCursor) {
            resourcesParams.next_cursor = nextCursor;
          }
          
          const resources = await cloudinary.api.resources(resourcesParams);
          
          if (resources.resources && Array.isArray(resources.resources)) {
            console.log(`Got ${resources.resources.length} ${resourceType}s on page ${pageCount}`);
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
          
          // Check if there are more pages
          nextCursor = resources.next_cursor || null;
        } while (nextCursor);
        
        console.log(`Completed ${resourceType}, found ${pageCount} pages`);
      } catch (resourceError) {
        console.warn(`Error fetching ${resourceType} resources:`, resourceError.message);
      }
    }

    // Convert Set to sorted array
    const folderArray = Array.from(folders)
      .sort((a, b) => a.localeCompare(b))
      .map(folderPath => ({
        path: folderPath,
        displayName: folderPath.split('/').pop() || folderPath
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    console.log(`Total unique folders found: ${folderArray.length}`);
    folderArray.slice(0, 10).forEach(f => console.log(`  - ${f.path}`));
    if (folderArray.length > 10) {
      console.log(`  ... and ${folderArray.length - 10} more`);
    }
    
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
