/**
 * Vercel serverless function: /api/upload
 * Handles image upload to Cloudinary with OCR processing
 * 
 * Features:
 * - Accepts image file + metadata (name, tapYear)
 * - Uploads to Cloudinary with ocr flag enabled
 * - Extracts OCR text from response
 * - Updates image context metadata (name, tapYear)
 * - Returns upload result with OCR text
 */

const { IncomingForm } = require('formidable');
const fs = require('fs');
const FormData = require('form-data');
const https = require('https');
const http = require('http');

// Parse multipart form data
async function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      maxFileSize: 1024 * 1024 * 50, // 50MB max
      keepExtensions: true
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      resolve({ fields, files });
    });
  });
}

// Make HTTPS request to Cloudinary
function cloudinaryRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const options = new URL(url);
    const requestOptions = {
      hostname: options.hostname,
      port: 443,
      path: options.pathname + options.search,
      method: method,
      headers: body.getHeaders ? body.getHeaders() : {}
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Cloudinary API error (${res.statusCode}): ${data}`));
          return;
        }

        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Invalid JSON response from Cloudinary: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    if (body) {
      body.pipe(req);
    } else {
      req.end();
    }
  });
}

// Upload to Cloudinary with OCR (server-side signed upload using SDK)
const cloudinary = require('cloudinary').v2;

async function uploadToCloudinary(filePath, filename, metadata) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Missing Cloudinary environment variables (cloud name, api key, api secret)');
  }

  // Configure SDK
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret
  });

  console.log(`Uploading to cloud (signed): ${cloudName}`);

  // Build context string
  const contextStr = `name=${metadata.name || ''}${metadata.tapYear ? `|tapYear=${metadata.tapYear}` : ''}`;

  // Generate unique public_id
  const publicId = `tap_${Date.now()}_${filename.replace(/\.[^/.]+$/, '')}`;

  try {
    const options = {
      ocr: 'adv_ocr',
      context: contextStr,
      public_id: publicId,
      resource_type: 'image',
      // Add tags for metadata (visible in Cloudinary Tags UI)
      tags: [metadata.name].filter(tag => tag) // Only include name, not tapYear
    };

    console.log('Upload options:', JSON.stringify(options, null, 2));
    console.log('Tags being sent:', options.tags);
    console.log('Calling cloudinary.uploader.upload...');

    const response = await cloudinary.uploader.upload(filePath, options);

    console.log('Upload successful:', response.public_id);
    console.log('Response tags:', response.tags);
    console.log('Response context:', response.context);
    return response;
  } catch (error) {
    // Surface Cloudinary error message text when possible
    const msg = error && error.message ? error.message : String(error);
    throw new Error(`Cloudinary upload failed: ${msg}`);
  }
}

// Extract OCR text from Cloudinary response
function extractOCRText(cloudinaryResponse) {
  if (!cloudinaryResponse.info || !cloudinaryResponse.info.ocr) {
    console.log('No OCR data in response');
    return '';
  }

  const ocrData = cloudinaryResponse.info.ocr;
  
  console.log('OCR data available:', JSON.stringify(ocrData).substring(0, 200));
  
  // If using adv_ocr, response includes ocr.data with text blocks
  try {
    if (ocrData.data && Array.isArray(ocrData.data)) {
      const text = ocrData.data
        .map(block => block.text || '')
        .filter(text => text.length > 0)
        .join(' ');
      console.log('Extracted text from OCR data:', text.substring(0, 100));
      return text;
    }
  } catch (e) {
    console.warn('Error parsing OCR data:', e.message);
  }

  // Fallback for other OCR formats
  return typeof ocrData === 'string' ? ocrData : JSON.stringify(ocrData);
}

// Generate searchable tags from OCR text
function generateOCRTags(ocrText) {
  if (!ocrText || ocrText.length === 0) {
    return [];
  }

  // Words/phrases to exclude
  const excludePatterns = ['Front Row:', 'Second Row:', 'Third Row:', 'Middle Row:'];
  const excludeWords = ['poly', 'polygon', 'vertex', 'vertices', 'edge', 'edges', 'face', 'faces', 'mesh', 'model', 'object', 'geometry', 'texture', 'material', '//', 'http', 'www', 'com', 'org', 'net'];

  // Split by commas and extract names only
  const tags = ocrText
    .split(',')
    .map(item => {
      // Remove row labels from the item
      let cleaned = item.trim();
      excludePatterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '').trim();
      });
      // Remove carriage returns, newlines, backslashes, and forward slashes
      cleaned = cleaned.replace(/[\r\n\t\\/]/g, ' ').trim();
      return cleaned;
    })
    .map(item => {
      // Extract only the name portion - typically capitalized words at the start
      // Remove any trailing descriptions or extra text after the name
      const nameMatch = item.match(/^([A-Za-z\s\-'\.]+?)(?:\s*\(.*\)|$)/);
      return nameMatch ? nameMatch[1].trim() : item;
    })
    .filter(item => {
      // Skip empty strings
      if (!item || item.length < 2) return false;
      
      // Skip items with JSON-like patterns, braces, quotes, colons
      if (/[\{\}\[\]:\\"']/.test(item)) return false;
      
      // Skip items with mostly numbers or coordinates
      const letterCount = (item.match(/[a-zA-Z]/g) || []).length;
      const numberCount = (item.match(/\d/g) || []).length;
      if (numberCount > letterCount) return false;
      
      // Require at least some alphabetic characters
      if (!/[a-zA-Z]/.test(item)) return false;
      
      // Skip technical/non-name terms
      const lowerItem = item.toLowerCase();
      if (excludeWords.some(word => lowerItem.includes(word))) return false;
      
      // Skip items with too many special characters
      const specialCharCount = (item.match(/[^a-zA-Z\s\-'\.]/g) || []).length;
      if (specialCharCount > 2) return false;
      
      // Require at least one space (first and last name) or at least 4 characters for single names
      if (!item.includes(' ') && item.length < 4) return false;
      
      return true;
    })
    .slice(0, 30) // Limit to 30 tags
    .filter(tag => {
      // Final check: remove tags that are just punctuation or spaces
      return /[a-zA-Z]/.test(tag);
    });

  // Deduplicate tags (case-insensitive)
  const uniqueTags = Array.from(new Set(tags.map(tag => tag.toLowerCase())))
    .map(lowerTag => tags.find(t => t.toLowerCase() === lowerTag)); // Preserve original casing
  
  return uniqueTags;
}

// Update asset tags with OCR data
async function updateAssetWithOCRTags(cloudinary, publicId, ocrText) {
  try {
    const ocrTags = generateOCRTags(ocrText);
    
    if (ocrTags.length === 0) {
      console.log('No OCR tags to add');
      return;
    }

    console.log('Adding OCR tags to asset:', ocrTags);

    // Add 'ocr_indexed' marker tag
    await cloudinary.uploader.add_tag('ocr_indexed', [publicId]);
    console.log('Added ocr_indexed tag');
    
    // Add all OCR-derived tags
    for (const tag of ocrTags) {
      await cloudinary.uploader.add_tag(tag, [publicId]);
    }

    console.log('OCR tags added successfully:', ocrTags);
  } catch (error) {
    console.error('Failed to update asset tags with OCR data:', error.message);
    // Don't throw - this is non-critical
  }
}

// Main handler (Vercel serverless format)
module.exports = async (req, res) => {
  console.log('=== Upload Request Started ===');
  console.log('Method:', req.method);
  
  // CORS headers
  if (!res.headersSent) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    if (!res.headersSent) {
      res.writeHead(200);
    }
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    console.log('Invalid method:', req.method);
    if (!res.headersSent) {
      res.writeHead(405, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let tempFilePath = null;

  try {
    console.log('Parsing form data...');
    
    // Parse form data
    const { fields, files } = await parseForm(req);
    
    console.log('Form parsed. Files object:', files);
    console.log('Files keys:', Object.keys(files));
    
    // Handle different formidable versions
    let file;
    if (files.file) {
      // Newer versions return arrays
      if (Array.isArray(files.file)) {
        file = files.file[0];
      } else {
        // Older versions return objects directly
        file = files.file;
      }
    }
    
    console.log('File object:', file);
    
    if (!file) {
      console.log('No file in upload');
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'No file uploaded' }));
      return;
    }

    tempFilePath = file.filepath;
    console.log('File received:', file.originalFilename || file.name, 'Path:', tempFilePath, 'Size:', file.size);

    // Extract metadata
    const imageName = Array.isArray(fields.name) ? fields.name[0] : fields.name;
    const tapYear = Array.isArray(fields.tapYear) ? fields.tapYear[0] : (fields.tapYear || null);

    console.log('Metadata:', { imageName, tapYear });

    if (!imageName) {
      console.log('Missing metadata: name is required');
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ 
        error: 'Missing metadata: name is required',
        received: { imageName }
      }));
      return;
    }

    console.log('Starting Cloudinary upload...');
    
    // Upload to Cloudinary
    const filename = file.originalFilename || file.name || 'image.jpg';
    const cloudinaryResponse = await uploadToCloudinary(
      tempFilePath,
      filename,
      { name: imageName, tapYear: tapYear }
    );

    console.log('Cloudinary upload complete. Response keys:', Object.keys(cloudinaryResponse));

    // Extract OCR text
    const ocrText = extractOCRText(cloudinaryResponse);
    
    // Add OCR text as tags to the asset
    if (ocrText) {
      console.log('Updating asset with OCR tags...');
      await updateAssetWithOCRTags(cloudinary, cloudinaryResponse.public_id, ocrText);
    }

    console.log('Preparing success response...');

    // Return success response
    const successResponse = {
      success: true,
      publicId: cloudinaryResponse.public_id,
      secureUrl: cloudinaryResponse.secure_url,
      name: imageName,
      ocrText: ocrText,
      tags: cloudinaryResponse.tags || [imageName].filter(tag => tag),
      context: cloudinaryResponse.context || { custom: { name: imageName } },
      metadata: {
        width: cloudinaryResponse.width,
        height: cloudinaryResponse.height,
        format: cloudinaryResponse.format,
        bytes: cloudinaryResponse.bytes,
        createdAt: cloudinaryResponse.created_at
      }
    };

    console.log('Upload successful, returning response');
    console.log('=== Upload Request Completed ===');
    
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify(successResponse));
    return;

  } catch (error) {
    console.error('=== Upload Error ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ 
      error: error.message || 'Upload failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }));
    return;

  } finally {
    // Clean up temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log('Temp file cleaned up');
      } catch (e) {
        console.warn('Failed to clean up temp file:', e.message);
      }
    }
  }
};
