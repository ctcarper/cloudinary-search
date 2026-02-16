# Image Upload with OCR - Setup Guide

## What's New

You now have a complete image upload and OCR workflow:

### New Files
- **[squarespace-uploader.html](squarespace-uploader.html)** — Standalone upload interface with OCR support
- **[api/upload.js](api/upload.js)** — Vercel serverless function handling uploads

### Updated Files
- **[package.json](package.json)** — Added `formidable` dependency
- **[dev-server.js](dev-server.js)** — Added `/api/upload` route support

## How It Works

1. **Upload**: User selects image via drag-drop or file picker
2. **OCR Processing**: Cloudinary extracts text using advanced OCR
3. **Metadata Entry**: User confirms/edits image name and tap year
4. **Storage**: Image stored with metadata in Cloudinary context fields

## Features

✅ Drag-and-drop file upload  
✅ Image preview  
✅ Auto-extracted filename → image name  
✅ OCR text display (from Cloudinary)  
✅ Manual metadata entry (name, tapYear)  
✅ Responsive mobile-friendly UI  
✅ Success/error messaging with copy-to-clipboard result  

## Local Testing

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create/update `.env`:
```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
PORT=3000
```

### 3. Start Dev Server
```bash
npm start
```

### 4. Test Upload
- **Search**: http://localhost:3000/squarespace-search.html
- **Upload**: http://localhost:3000/squarespace-uploader.html

## Deployment to Vercel

### 1. Already Deployed
Your `/api/search` endpoint is already live at:
```
https://cloudinary-search.vercel.app/api/search
```

### 2. Deploy Upload Endpoint
```bash
npm install  # Install formidable dependency
vercel --prod
```

### 3. Update Frontend URLs
Once deployed, update `squarespace-uploader.html` if needed:
```javascript
// Change from:
const response = await fetch('/api/upload', {...})

// To:
const response = await fetch('https://your-vercel-url.vercel.app/api/upload', {...})
```

## Integration with Squarespace

### Option 1: Separate Pages
Keep search and upload as separate pages:
- **Search**: Embed `squarespace-search.html` on one page
- **Upload**: Embed `squarespace-uploader.html` on another

### Option 2: Single Page with Tabs
(Instructions provided on request)

## Metadata Storage

Images are stored in Cloudinary with context metadata:
```
context: {
  name: "user-provided-name",
  tapYear: "user-provided-year"
}
```

### Retrieve in Search Page
The search endpoint already returns all context metadata, so metadata will appear in the search results gallery.

## Troubleshooting

### Upload Fails with "Missing Environment Variables"
- Verify `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` in `.env`
- For Vercel: Add these to project settings → Environment Variables

### No OCR Text Appears
- Cloudinary must have OCR quota configured (paid add-on)
- Alternatively: Set `ocr: 'adv_ocr'` in `api/upload.js` or `ocr: 'ocr'` for basic OCR
- Check Cloudinary dashboard for OCR usage limits

### Image Uploads but Metadata Doesn't Appear in Search
- Verify metadata context is being set correctly
- Check Cloudinary dashb    oard: Asset → Details → Context tab
- May take a few seconds to sync

## Next Steps

1. **Deploy to Vercel** (if not already done)
2. **Test locally** at http://localhost:3000/squarespace-uploader.html
3. **Embed in Squarespace** using custom code blocks
4. **Monitor uploads** in Cloudinary dashboard

---

**Questions or Issues?** Check Cloudinary API docs or contact support.
