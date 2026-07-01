# Security Review - Cloudinary Search

**Date:** 2026-06-30  
**Status:** ⚠️ MULTIPLE ISSUES FOUND

---

## 🔴 Critical Issues

### 1. API Key in URL Parameter (CRITICAL)
**Location:** Frontend + Backend  
**Severity:** 🔴 CRITICAL

**Problem:**
- API key can be passed via `?key=` URL parameter
- URLs are logged in server access logs, browser history, and referer headers
- Credentials should NEVER be in URLs

**Current Code (squarespace-search.html line ~700):**
```javascript
const API_KEY = urlParams.get('key') || window.API_KEY || '';
```

**Fix:** Remove URL parameter support entirely - only accept header-based auth

---

### 2. CORS Policy Too Permissive (CRITICAL)
**Location:** dev-server.js, all API files  
**Severity:** 🔴 CRITICAL

**Problem:**
- Sets `Access-Control-Allow-Origin: *` globally
- This overrides origin validation checks below
- Allows any origin to access your API

**Current Code (dev-server.js line ~17):**
```javascript
res.setHeader('Access-Control-Allow-Origin', '*');
```

**Fix:** Replace with specific allowed origins:
```javascript
const ALLOWED_ORIGINS = [
  'https://www.sigmasigma.org',
  'https://sigmasigma.org'
];

// Only in dev:
if (req.headers.host.includes('localhost')) {
  ALLOWED_ORIGINS.push('http://localhost:3000');
}

res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : 'null');
```

---

### 3. No Security Headers (CRITICAL)
**Location:** All responses  
**Severity:** 🔴 CRITICAL

**Missing Headers:**
```
X-Content-Type-Options: nosniff        (Prevent MIME type sniffing)
X-Frame-Options: DENY                  (Prevent clickjacking)
Strict-Transport-Security: max-age=31536000  (Force HTTPS)
Content-Security-Policy: default-src 'self' (Prevent XSS)
```

**Fix:** Add to dev-server.js before routing:
```javascript
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('X-Frame-Options', 'DENY');
res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
```

---

## 🟠 High Severity Issues

### 4. No Rate Limiting (HIGH)
**Location:** All API endpoints  
**Severity:** 🟠 HIGH

**Problem:**
- API can be abused with unlimited requests
- No protection against brute force or DDoS
- Cloudinary API could be hit excessively

**Fix:** Implement rate limiting (example):
```javascript
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100  // limit each IP to 100 requests per windowMs
});
app.use(limiter);
```

---

### 5. No Input Validation for URL Parameters (HIGH)
**Location:** api/download-pdf.js  
**Severity:** 🟠 HIGH

**Problem:**
```javascript
const { cloudName, version, publicId, fileName } = body;
const url = `https://res.cloudinary.com/${cloudName}/image/upload/${version}/${publicId}`;
```
- No validation that cloudName/publicId are valid
- Could allow URL injection attacks

**Fix:**
```javascript
// Validate cloudName and publicId format
const CLOUD_NAME_REGEX = /^[a-z0-9-]+$/;
const PUBLIC_ID_REGEX = /^[a-zA-Z0-9\/_-]+$/;

if (!CLOUD_NAME_REGEX.test(cloudName)) {
  return res.status(400).json({ error: 'Invalid cloudName format' });
}

if (!PUBLIC_ID_REGEX.test(publicId)) {
  return res.status(400).json({ error: 'Invalid publicId format' });
}

if (version && !/^v\d+$/.test(version)) {
  return res.status(400).json({ error: 'Invalid version format' });
}
```

---

### 6. Sensitive Data in Error Messages (HIGH)
**Location:** api/search.js line ~115  
**Severity:** 🟠 HIGH

**Problem:**
```javascript
return res.status(resp.status).json({ error: 'Cloudinary error', detail: text });
```
- Exposes raw Cloudinary API error messages to client
- Could leak internal API details

**Fix:**
```javascript
console.error('Cloudinary API error:', text);  // Log for debugging
return res.status(resp.status).json({ error: 'Search service unavailable' });
```

---

### 7. No Fetch Timeout (HIGH)
**Location:** Frontend (squarespace-search.html) + Backend (all API files)  
**Severity:** 🟠 HIGH

**Problem:**
- Fetch requests could hang indefinitely
- Client could hang waiting for response
- Denial of service

**Fix - Frontend:**
```javascript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

try {
  const response = await fetch(url, {
    headers: getApiHeaders(),
    signal: controller.signal
  });
  clearTimeout(timeoutId);
  // ... handle response
} catch (err) {
  if (err.name === 'AbortError') {
    showError('Request timeout - please try again');
  }
}
```

---

## 🟡 Medium Severity Issues

### 8. No Audit Logging (MEDIUM)
**Location:** All API endpoints  
**Severity:** 🟡 MEDIUM

**Problem:**
- No record of API access for security auditing
- Cannot investigate suspicious activity

**Fix:** Add logging to all endpoints:
```javascript
console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} | Origin: ${req.headers.origin} | IP: ${req.ip}`);
```

---

### 9. Missing Response Validation (MEDIUM)
**Location:** Frontend (squarespace-search.html)  
**Severity:** 🟡 MEDIUM

**Problem:**
- No validation that Cloudinary response is expected format
- Could crash if API response structure changes

**Fix:**
```javascript
if (!Array.isArray(data.resources)) {
  throw new Error('Invalid API response - missing resources array');
}
```

---

### 10. localStorage Security (MEDIUM)
**Location:** squarespace-search.html  
**Severity:** 🟡 MEDIUM

**Problem:**
- Any malicious script can read localStorage
- API keys should never be stored locally

**Current Code:**
```javascript
const API_KEY = urlParams.get('key') || window.API_KEY || '';
```

**Fix:**
- Never store API key in localStorage
- If API key needed, pass only via header
- Consider using session cookies with httpOnly flag instead

---

### 11. No XSS Protection on Dynamic HTML (MEDIUM)
**Location:** squarespace-search.html line ~850  
**Severity:** 🟡 MEDIUM

**Problem:**
```javascript
openModal(${JSON.stringify(item).replace(/"/g, '&quot;')})
```
- Uses `escapeHtml()` which is good, but inline event handlers are risky
- Better to use data attributes + event listeners

**Fix:**
```html
<!-- Instead of onclick in element -->
<div class="gallery-item" data-item='${JSON.stringify(item)}'>
  ...
</div>

<!-- Add event listener -->
document.addEventListener('click', (e) => {
  const item = e.target.closest('[data-item]');
  if (item) {
    const itemData = JSON.parse(item.getAttribute('data-item'));
    openModal(itemData);
  }
});
```

---

### 12. No Content-Type Validation (MEDIUM)
**Location:** All API endpoints  
**Severity:** 🟡 MEDIUM

**Problem:**
- No validation that request is JSON
- Could accept malformed data

**Fix:**
```javascript
// Add to all POST endpoints
if (req.method === 'POST') {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    return res.status(400).json({ error: 'Content-Type must be application/json' });
  }
}
```

---

## 🟢 Low Severity Issues

### 13. Missing HTTPS Redirect (LOW)
**Location:** dev-server.js  
**Severity:** 🟢 LOW

**Problem:**
- HTTP traffic not redirected to HTTPS in production
- Credentials could be intercepted

**Fix:** Add HTTPS redirect in production

---

### 14. No CSRF Token (LOW)
**Location:** Frontend  
**Severity:** 🟢 LOW (Read-only API)

**Note:** Since API is read-only, CSRF risk is low. But for write operations (upload), add CSRF tokens.

---

## 📋 Recommended Fixes (Priority Order)

### Phase 1 (CRITICAL - Do Immediately)
- [ ] Remove `?key=` URL parameter support
- [ ] Fix CORS to use specific allowed origins only
- [ ] Add security headers
- [ ] Validate download-pdf.js input parameters

### Phase 2 (HIGH - Next Sprint)
- [ ] Add fetch timeout handling (frontend + backend)
- [ ] Remove sensitive data from error messages
- [ ] Implement rate limiting
- [ ] Add audit logging

### Phase 3 (MEDIUM - Soon)
- [ ] Refactor inline event handlers to data attributes
- [ ] Add response validation
- [ ] Add Content-Type validation to POST requests
- [ ] Review and secure localStorage usage

### Phase 4 (LOW - Polish)
- [ ] HTTPS redirect in production
- [ ] Consider CSRF tokens for future write operations

---

## 🔐 Environment Variables Checklist

**Must set in `.env`:**
```
UPLOADER_API_KEY=<your-secure-random-key>
CLOUDINARY_CLOUD_NAME=<your-cloud-name>
CLOUDINARY_API_KEY=<your-api-key>
CLOUDINARY_API_SECRET=<your-api-secret>
NODE_ENV=production
```

**NEVER commit .env file to git**

---

## 🧪 Testing

Test these scenarios:

1. **Origin Blocking:** Request from unauthorized origin should return 403
2. **Auth Blocking:** Request without API key should return 401
3. **Rate Limiting:** >100 requests in 15 min should be throttled
4. **Input Validation:** Invalid publicId format should return 400
5. **Timeout:** Request taking >5s should abort
6. **Security Headers:** All responses should include required headers

---

**Next Step:** Would you like me to implement these fixes?
