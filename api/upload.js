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

// Allowed origins for referrer validation
const ALLOWED_ORIGINS = [
  'https://www.sigmasigma.org',
  'https://sigmasigma.org',
  'http://localhost',
  'http://localhost:3000'
];

// Validate request origin
function isAllowedOrigin(req) {
  const referer = req.headers.referer || '';
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  
  // Allow localhost requests (for development)
  if (host.includes('localhost')) {
    return true;
  }
  
  // Check if referer starts with any allowed origin
  const refererAllowed = ALLOWED_ORIGINS.some(allowed => referer.startsWith(allowed));
  const originAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed);
  
  return refererAllowed || originAllowed;
}

// Parse multipart form data
async function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      maxFileSize: 1024 * 1024 * 500, // 500MB max
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
    const missing = [];
    if (!cloudName) missing.push('CLOUDINARY_CLOUD_NAME');
    if (!apiKey) missing.push('CLOUDINARY_API_KEY');
    if (!apiSecret) missing.push('CLOUDINARY_API_SECRET');
    throw new Error(`Missing Cloudinary environment variables: ${missing.join(', ')}. Check your .env file.`);
  }

  // Configure SDK
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });

  console.log(`Uploading to cloud: ${cloudName}`);
  console.log('Environment variables loaded:', {
    cloudName: cloudName,
    apiKeyLength: apiKey ? apiKey.length : 0,
    apiSecretLength: apiSecret ? apiSecret.length : 0
  });

  // Build context string
  const contextStr = `name=${metadata.name || ''}${metadata.tapYear ? `|tapYear=${metadata.tapYear}` : ''}`;

  // Generate unique public_id
  const publicId = `tap_${Date.now()}_${filename.replace(/\.[^/.]+$/, '')}`;

  try {
    const options = {
      context: contextStr,
      public_id: publicId,
      // Add tags for metadata (visible in Cloudinary Tags UI)
      tags: [metadata.name].filter(tag => tag), // Only include name, not tapYear
      timeout: 120000 // 120 second timeout for large file uploads
    };

    // Add audio tag for audio files
    if (metadata.isAudio) {
      options.tags.push('audio');
    }

    // Add any additional tags from user input
    if (metadata.additionalTags && Array.isArray(metadata.additionalTags)) {
      options.tags = options.tags.concat(metadata.additionalTags);
    }

    // Only add OCR for images
    if (metadata.isImage) {
      options.ocr = 'adv_ocr';
    } else if (metadata.isAudio) {
      // For audio files, use resource_type: 'video' (Cloudinary accepts audio in video container)
      options.resource_type = 'video';
    } else if (metadata.isPDF) {
      // For PDFs, use resource_type: 'image' per Cloudinary documentation
      // PDFs are uploaded as image assets, not raw documents
      options.resource_type = 'image';
      // Add PDF tag for identification
      options.tags.push('pdf');
    } else {
      // For video files, explicitly set resource_type to video
      options.resource_type = 'video';
    }

    // Add folder if specified
    if (metadata.folder) {
      options.folder = metadata.folder;
      console.log('Upload folder:', metadata.folder);
    }

    // Get file stats to determine upload method
    const fileStats = fs.statSync(filePath);
    const fileSizeMB = fileStats.size / (1024 * 1024);
    console.log(`File size: ${fileSizeMB.toFixed(2)} MB`);

    console.log('Upload options:', JSON.stringify(options, null, 2));
    console.log('Tags being sent:', options.tags);
    console.log('Media type: ' + (metadata.isImage ? 'image' : (metadata.isPDF ? 'document/PDF' : (metadata.isAudio ? 'audio' : 'video'))));
    
    let response;
    
    // For large files (>100MB), use streaming upload to avoid 413 payload errors
    if (fileSizeMB > 100) {
      console.log('Using streaming upload for large file...');
      // Add extended timeout for streaming uploads
      options.timeout = 300000; // 5 minute timeout for streaming
      
      response = await new Promise((resolve, reject) => {
        const handleStream = cloudinary.uploader.upload_stream(options, (error, result) => {
          if (error) {
            reject(new Error(`Cloudinary stream upload failed: ${error.message}`));
          } else {
            resolve(result);
          }
        });
        
        fs.createReadStream(filePath)
          .on('error', (error) => {
            handleStream.destroy();
            reject(new Error(`File stream error: ${error.message}`));
          })
          .pipe(handleStream);
      });
    } else {
      console.log('Using standard upload...');
      response = await cloudinary.uploader.upload(filePath, options);
    }

    console.log('Upload successful:', response.public_id);
    console.log('Response tags:', response.tags);
    console.log('Response context:', response.context);
    return response;
  } catch (error) {
    console.error('Cloudinary upload error details:', {
      message: error.message,
      status: error.status,
      statusCode: error.statusCode,
      http_code: error.http_code,
      fullError: error
    });
    
    // Provide helpful error message
    let msg = error && error.message ? error.message : String(error);
    if (error.http_code === 404 || error.status === 404) {
      msg = `Cloudinary API 404 - Check that CLOUDINARY_CLOUD_NAME is correct (currently: "${process.env.CLOUDINARY_CLOUD_NAME}"). Full error: ${msg}`;
    }
    if (error.http_code === 401 || error.status === 401) {
      msg = `Cloudinary authentication failed - Check that CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are correct. Full error: ${msg}`;
    }
    if (error.http_code === 413 || error.status === 413) {
      msg = `Cloudinary 413 Payload Too Large - This shouldn't occur with streaming uploads. Try uploading again, or check if the video codec or format is supported. Full error: ${msg}`;
    }
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

  // Preprocess: Clean up problematic characters and formatting
  let cleanedText = ocrText
    // Remove special symbols and Greek letters
    .replace(/[Σσ]/g, '')  // Remove Sigma symbols
    .replace(/[\r\n]+/g, ' ')  // Replace newlines with spaces
    .replace(/\\n/g, ' ')  // Replace literal \n with spaces
    .replace(/ocr_/g, '')  // Remove ocr_ prefix
    .replace(/\\t/g, ' ')  // Replace literal tabs
    .replace(/\s+/g, ' ')  // Collapse multiple spaces into one
    .trim();

  // Split by commas to get individual names
  const tags = cleanedText
    .split(',')
    .map(item => {
      // Trim whitespace
      let cleaned = item.trim();
      
      // Remove descriptions in parentheses and extra text after them
      cleaned = cleaned.replace(/\s*\(.*\)\s*/g, '').trim();
      
      // Remove any row labels
      cleaned = cleaned.replace(/^(Front|Second|Third|Middle)\s+Row:\s*/i, '').trim();
      
      // Remove any trailing non-alphabetic characters
      cleaned = cleaned.replace(/[^a-zA-Z\s\-\.\']+$/g, '').trim();
      
      return cleaned;
    })
    .filter(item => {
      // Skip empty strings
      if (!item || item.length < 2) return false;
      
      // Must contain at least one letter
      if (!/[a-zA-Z]/.test(item)) return false;
      
      // Skip items that are just numbers or technical terms
      const lowerItem = item.toLowerCase();
      const technicalTerms = ['sigma', 'back', 'row', 'front', 'second', 'third', 'middle', 'side', 'group'];
      if (technicalTerms.some(term => lowerItem === term)) return false;
      
      // Require at least 3 characters for single words, or accept 2+ word names
      if (!item.includes(' ') && item.length < 3) return false;
      
      return true;
    })
    .slice(0, 30); // Limit to 30 tags

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

// Helper function to send response with CORS headers
function sendResponse(res, statusCode, body) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key'
  };
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(body));
}

// Main handler (Vercel serverless format)
module.exports = async (req, res) => {
  console.log('=== Upload Request Started ===');
  console.log('Method:', req.method);
  
  // Handle OPTIONS requests
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key'
    });
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    console.log('Invalid method:', req.method);
    sendResponse(res, 405, { error: 'Method not allowed' });
    return;
  }

  // Validate origin
  if (!isAllowedOrigin(req)) {
    sendResponse(res, 403, { error: 'Access denied - invalid origin' });
    return;
  }

  // API key authentication
  const apiKey = req.query.key || req.headers['x-api-key'];
  const validKey = process.env.UPLOADER_API_KEY;

  if (!validKey) {
    sendResponse(res, 500, { error: 'Server configuration error' });
    return;
  }

  if (!apiKey || apiKey !== validKey) {
    sendResponse(res, 401, { error: 'Unauthorized: Invalid or missing API key' });
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
      sendResponse(res, 400, { error: 'No file uploaded' });
      return;
    }

    tempFilePath = file.filepath;
    console.log('File received:', file.originalFilename || file.name, 'Path:', tempFilePath, 'Size:', file.size);

    // Extract metadata
    const imageName = Array.isArray(fields.name) ? fields.name[0] : fields.name;
    const tapYear = Array.isArray(fields.tapYear) ? fields.tapYear[0] : (fields.tapYear || null);
    const folder = Array.isArray(fields.folder) ? fields.folder[0] : (fields.folder || null);
    
    // Extract tags (can be a JSON string if sent from frontend)
    let additionalTags = [];
    if (fields.tags) {
      const tagsValue = Array.isArray(fields.tags) ? fields.tags[0] : fields.tags;
      try {
        additionalTags = JSON.parse(tagsValue);
      } catch (e) {
        // If not JSON, split by comma
        additionalTags = tagsValue.split(',').map(t => t.trim()).filter(t => t);
      }
    }
    
    // Detect file type based on MIME type
    const mimeType = file.mimetype || '';
    const isImage = mimeType.startsWith('image/');
    const isAudio = mimeType.startsWith('audio/');
    const isPDF = mimeType === 'application/pdf' || file.originalFilename?.toLowerCase().endsWith('.pdf');
    console.log('File MIME type:', mimeType);
    console.log('Is image:', isImage);
    console.log('Is audio:', isAudio);
    console.log('Is PDF:', isPDF);
    console.log('Additional tags:', additionalTags);

    console.log('Metadata:', { imageName, tapYear, folder, isImage, isAudio, isPDF });

    if (!imageName) {
      console.log('Missing metadata: name is required');
      sendResponse(res, 400, {
        error: 'Missing metadata: name is required',
        received: { imageName }
      });
      return;
    }

    console.log('Starting Cloudinary upload...');
    
    // Upload to Cloudinary
    const filename = file.originalFilename || file.name || 'image.jpg';
    const cloudinaryResponse = await uploadToCloudinary(
      tempFilePath,
      filename,
      { name: imageName, tapYear: tapYear, folder: folder, isImage: isImage, isAudio: isAudio, isPDF: isPDF, additionalTags: additionalTags }
    );

    console.log('Cloudinary upload complete. Response keys:', Object.keys(cloudinaryResponse));

    // Extract OCR text and update tags (only for images)
    let ocrText = '';
    if (isImage) {
      ocrText = extractOCRText(cloudinaryResponse);
      
      if (ocrText) {
        console.log('Updating asset with OCR tags...');
        await updateAssetWithOCRTags(cloudinary, cloudinaryResponse.public_id, ocrText);
      }
    } else {
      console.log('Skipping OCR processing for non-image file');
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
    
    sendResponse(res, 200, successResponse);
    return;

  } catch (error) {
    console.error('=== Upload Error ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    sendResponse(res, 500, {
      error: error.message || 'Upload failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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
