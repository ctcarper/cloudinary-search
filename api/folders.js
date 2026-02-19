/**
 * Vercel serverless function: /api/folders
 * Fetches available folders from Cloudinary Media Library
 * Uses in-memory caching with 24-hour TTL to avoid expensive repeated calls
 */

const cloudinary = require('cloudinary').v2;

// In-memory cache with TTL
let folderCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Get list of folders from Cloudinary
async function getFoldersFromCloudinary() {
  // Check if cache is still valid
  if (folderCache && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    console.log('Returning cached folders');
    return folderCache;
  }

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
    
    // Get root level folders and subfolders via API (fast, no resource fetching)
    console.log('Fetching folder structure from Cloudinary...');
    try {
      const rootFoldersResult = await cloudinary.api.root_folders();
      
      if (rootFoldersResult.folders && Array.isArray(rootFoldersResult.folders)) {
        console.log(`Found ${rootFoldersResult.folders.length} root folders`);
        
        // Add root folders
        rootFoldersResult.folders.forEach(folder => {
          folders.add(folder.name);
        });
        
        // Recursively get subfolders for each root folder
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
    } catch (apiError) {
      console.error('Error fetching folders from API:', apiError.message);
      throw apiError;
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
    
    // Cache the results
    folderCache = folderArray;
    cacheTimestamp = Date.now();
    
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
