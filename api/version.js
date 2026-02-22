/**
 * Vercel serverless function: /api/version
 * Returns the current app version
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.writeHead(200);
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read version from version.json
  try {
    const version = require('../version.json');
    return res.status(200).json(version);
  } catch (error) {
    console.error('Error reading version:', error);
    // Fallback version
    return res.status(200).json({ version: '1.0.0' });
  }
};
