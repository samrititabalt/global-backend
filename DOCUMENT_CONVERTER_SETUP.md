# Document Converter & PDF Editor - Setup Instructions

## Required NPM Packages

Install the following packages in the `global-backend` directory:

```bash
cd global-backend
npm install puppeteer
```

**Note:** Puppeteer will automatically download Chromium on first install. This may take a few minutes.

If you encounter issues with Puppeteer installation:
- On Linux servers, you may need: `sudo apt-get install -y libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2`
- On Windows, Puppeteer should work out of the box
- For production, consider using `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false` if you have Chrome installed system-wide

## Features Implemented

### 1. Word → PDF Conversion
- **Preserves:** Formatting, tables, images, signatures, layout
- **Method:** Uses `mammoth` to convert Word to HTML, then `puppeteer` to render HTML to PDF
- **Supports:** .docx files (full support), .doc files (requires LibreOffice)

### 2. PDF → Word Conversion
- **Preserves:** Text structure, paragraphs, headings
- **Method:** Uses `pdf-parse` to extract text, then `docx` library to create Word document
- **Limitations:** Tables and complex layouts may not be perfectly preserved (PDF structure is complex)

### 3. PDF Editing
- **Features:** Add text, highlight areas, draw annotations
- **Method:** Uses `pdf-lib` to embed annotations directly into PDF
- **Persistence:** All edits are permanently saved in the PDF file

## API Endpoints

All endpoints require authentication (customer role):

1. `POST /api/document-converter/word-to-pdf`
   - Upload: Word file (.docx)
   - Returns: PDF file with preserved formatting

2. `POST /api/document-converter/pdf-to-word`
   - Upload: PDF file
   - Returns: Word document (.docx)

3. `POST /api/document-converter/edit-pdf`
   - Upload: PDF file + annotations (JSON)
   - Returns: Edited PDF with embedded annotations

## Troubleshooting

### Puppeteer Issues
- If Puppeteer fails to launch, check system dependencies
- For Docker deployments, ensure Chrome dependencies are installed
- Consider using `puppeteer-core` with a system Chrome installation

### Memory Issues
- Large files may require increased Node.js memory: `node --max-old-space-size=4096 server.js`
- Consider implementing file size limits (currently 50MB)

### PDF Editing Coordinates
- The coordinate system assumes a viewer size of approximately 800x600px
- If annotations appear misaligned, adjust the scale factors in `documentConverter.js` (lines with `scaleX` and `scaleY`)

## Testing

Test with:
1. Word documents with tables, images, and formatting
2. PDFs with selectable text
3. PDF editing: Add text, highlights, and drawings, then verify they persist after saving
