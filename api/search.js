const btoa = (str) => Buffer.from(str).toString('base64');

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
  
  // Check if referer starts with any allowed origin
  const refererAllowed = ALLOWED_ORIGINS.some(allowed => referer.startsWith(allowed));
  const originAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed);
  
  return refererAllowed || originAllowed;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate origin
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Access denied - invalid origin' });
  }

  // API key authentication
  const apiKey = req.query.key || req.headers['x-api-key'];
  const validKey = process.env.UPLOADER_API_KEY;

  if (!validKey) {
    console.error('UPLOADER_API_KEY environment variable not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }

  const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
  const API_KEY = process.env.CLOUDINARY_API_KEY;
  const API_SECRET = process.env.CLOUDINARY_API_SECRET;

  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return res.status(500).json({ error: 'Missing Cloudinary environment variables.' });
  }

  const getParam = (name) => {
    if (req.method === 'GET') return req.query[name];
    if (req.method === 'POST') return (req.body && req.body[name]) || undefined;
    return undefined;
  };

  const q = (getParam('q') || '').toString().trim();
  const next_cursor = (getParam('next_cursor') || '').toString().trim() || undefined;
  const max_results = Math.min(parseInt(getParam('max_results')) || 30, 100); // Default 30, max 100
  const folder = (getParam('folder') || '').toString().trim() || undefined;

  const escapePhrase = (s) => s.replace(/"/g, '\\"');

  let expression;
  if (!q && !folder) {
    // No query and no folder - show all images/videos
    expression = '(resource_type:image OR resource_type:video)';
  } else if (q && !folder) {
    // Query without folder - search all
    const esc = escapePhrase(q);
    expression = `(resource_type:image OR resource_type:video) AND tags:"${esc}"`;
  } else if (!q && folder) {
    // Folder without query - show all items in folder
    expression = `(resource_type:image OR resource_type:video) AND folder:"${escapePhrase(folder)}"`;
  } else {
    // Both query and folder - search within folder
    const esc = escapePhrase(q);
    expression = `(resource_type:image OR resource_type:video) AND tags:"${esc}" AND folder:"${escapePhrase(folder)}"`;
  }

  const body = {
    expression,
    max_results: max_results,
  };
  if (next_cursor) body.next_cursor = next_cursor;

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${API_KEY}:${API_SECRET}`)}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: 'Cloudinary error', detail: text });
    }

    const data = await resp.json();

    const safeResults = (data.resources || []).map(r => ({
      asset_id: r.asset_id,
      public_id: r.public_id,
      secure_url: r.secure_url || r.url,
      width: r.width,
      height: r.height,
      format: r.format,
      resource_type: r.resource_type,
      created_at: r.created_at,
      tags: r.tags || [],
      bytes: r.bytes,
      duration: r.duration,
      type: r.type,
      metadata: r.metadata || {},
      context: r.context || {},
      alt: r.context?.alt || null,
      caption: r.context?.caption || null,
      description: r.context?.raw_description || null
    }));

    return res.status(200).json({
      results: safeResults,
      next_cursor: data.next_cursor,
      total_count: data.total_count || safeResults.length
    });
  } catch (err) {
    return res.status(500).json({ error: 'Request failed', detail: err.message });
  }
};
