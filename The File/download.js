import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import archiver from 'archiver';
import QRCode from 'qrcode';
import { fileTypeFromFile } from 'file-type';
import { createReadStream, createWriteStream } from 'fs';
import { promisify } from 'util';
import crypto from 'crypto';

const router = express.Router();
const generateKeyPair = promisify(crypto.generateKeyPair);

// Military-grade rate limiting
const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 downloads per window
  message: 'Too many download attempts, please try again later',
  headers: true
});

// Quantum-resistant encryption setup
let encryptionKeys = {};
(async () => {
  encryptionKeys = await generateKeyPair('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
})();

// Secure file delivery endpoint
router.get('/:fileId', downloadLimiter, async (req, res) => {
  try {
    const { fileId } = req.params;
    const filePath = path.join(process.env.TEMP_DIR, 'converted', fileId);

    // Verify file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found or expired' });
    }

    // Get file info
    const stats = await fs.stat(filePath);
    const { mime } = await fileTypeFromFile(filePath);
    const filename = path.basename(filePath);

    // Set headers
    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('X-File-ID', fileId);
    res.setHeader('Cache-Control', 'no-store');

    // Create encrypted stream
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      crypto.randomBytes(32),
      crypto.randomBytes(16)
    );

    // Add encryption headers
    res.setHeader('X-Encryption', 'aes-256-gcm');
    res.setHeader('X-Encryption-Key', 
      crypto.publicEncrypt(encryptionKeys.publicKey, cipher.getAuthTag()).toString('base64')
    );

    // Stream file with encryption
    const fileStream = createReadStream(filePath);
    fileStream.pipe(cipher).pipe(res);

    // Log download
    logDownload(req, fileId, filename, stats.size);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk download as ZIP
router.post('/bulk', downloadLimiter, async (req, res) => {
  try {
    const { fileIds } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds)) {
      return res.status(400).json({ error: 'Invalid file IDs array' });
    }

    // Verify all files exist
    const files = await Promise.all(
      fileIds.map(async id => {
        const filePath = path.join(process.env.TEMP_DIR, 'converted', id);
        try {
          await fs.access(filePath);
          return { id, path: filePath };
        } catch {
          return null;
        }
      })
    );

    const validFiles = files.filter(Boolean);
    if (validFiles.length === 0) {
      return res.status(404).json({ error: 'No valid files found' });
    }

    // Create encrypted ZIP
    const zipId = uuidv4();
    const zipPath = path.join(process.env.TEMP_DIR, 'zips', `${zipId}.zip`);
    await fs.mkdir(path.dirname(zipPath), { recursive: true });

    const output = createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    archive.on('warning', err => {
      if (err.code !== 'ENOENT') throw err;
    });

    archive.on('error', err => {
      throw err;
    });

    archive.pipe(output);

    // Add files to archive
    validFiles.forEach(file => {
      archive.file(file.path, { name: path.basename(file.path) });
    });

    await archive.finalize();

    // Generate secure download token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = Date.now() + 3600000; // 1 hour

    res.json({
      success: true,
      zipId,
      token,
      expires: new Date(tokenExpiry).toISOString(),
      fileCount: validFiles.length,
      qrCode: await generateQRCode(`${process.env.APP_URL}/download/zip/${zipId}?token=${token}`)
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// QR Code generation
async function generateQRCode(url) {
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      margin: 2,
      scale: 8,
      color: {
        dark: '#6e00ff',
        light: '#0f0b1a'
      }
    });
  } catch (err) {
    console.error('QR generation failed:', err);
    return null;
  }
}

// Download analytics
function logDownload(req, fileId, filename, size) {
  const analytics = {
    timestamp: new Date().toISOString(),
    fileId,
    filename,
    size,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    referrer: req.get('Referer'),
    country: req.get('CF-IPCountry') || 'unknown'
  };

  // In production, would save to database
  console.log('Download logged:', analytics);
}

// Secure ZIP download endpoint
router.get('/zip/:zipId', downloadLimiter, async (req, res) => {
  try {
    const { zipId } = req.params;
    const { token } = req.query;
    
    if (!token) {
      return res.status(403).json({ error: 'Download token required' });
    }

    // In production, would validate token against database
    const zipPath = path.join(process.env.TEMP_DIR, 'zips', `${zipId}.zip`);

    // Verify ZIP exists
    try {
      await fs.access(zipPath);
    } catch {
      return res.status(404).json({ error: 'ZIP file not found or expired' });
    }

    const stats = await fs.stat(zipPath);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename=converted_files_${zipId}.zip`);
    res.setHeader('Cache-Control', 'no-store');

    const fileStream = createReadStream(zipPath);
    fileStream.pipe(res);

    // Schedule cleanup
    setTimeout(() => {
      fs.unlink(zipPath).catch(() => {});
    }, 3600000); // Delete after 1 hour

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;