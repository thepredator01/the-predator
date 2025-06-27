import fs from 'fs/promises';
import path from 'path';
import { Worker } from 'worker_threads';
import cron from 'node-cron';

// Quantum Garbage Collector
export class CosmicCleanup {
  static async startAutoCleanup() {
    // Schedule cleanup every hour
    cron.schedule('0 * * * *', () => {
      this.cleanTempDirectories().catch(console.error);
    });
    
    // Also run on startup
    await this.cleanTempDirectories();
  }

  static async cleanTempDirectories() {
    const tempDirs = [
      path.join(process.env.TEMP_DIR, 'uploads'),
      path.join(process.env.TEMP_DIR, 'converted'),
      path.join(process.env.TEMP_DIR, 'zips'),
      path.join(process.env.TEMP_DIR, 'secure')
    ];
    
    const results = await Promise.allSettled(
      tempDirs.map(dir => this.cleanDirectory(dir))
    );
    
    return results.map((result, i) => ({
      directory: tempDirs[i],
      status: result.status,
      ...(result.status === 'fulfilled' ? result.value : { error: result.reason })
    }));
  }

  static async cleanDirectory(directory, maxAgeHours = 24) {
    try {
      await fs.access(directory);
      const files = await fs.readdir(directory);
      const now = Date.now();
      const cutoff = now - (maxAgeHours * 60 * 60 * 1000);
      
      const deletionResults = await Promise.allSettled(
        files.map(async (file) => {
          const filePath = path.join(directory, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtimeMs < cutoff) {
            await fs.unlink(filePath);
            return { file, deleted: true };
          }
          return { file, deleted: false, reason: 'Not expired' };
        })
      );
      
      return {
        totalFiles: files.length,
        deleted: deletionResults.filter(r => r.value?.deleted).length,
        failed: deletionResults.filter(r => r.status === 'rejected').length,
        details: deletionResults.map(r => 
          r.status === 'fulfilled' ? r.value : { error: r.reason }
        )
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { error: 'Directory does not exist', path: directory };
      }
      throw error;
    }
  }

  static async secureWipe(filePath, passes = 3) {
    try {
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;
      const patterns = [
        Buffer.alloc(fileSize, 0x00), // Null bytes
        Buffer.alloc(fileSize, 0xFF), // Ones
        Buffer.alloc(fileSize, crypto.randomBytes(1)[0]) // Random
      ];
      
      for (let i = 0; i < passes; i++) {
        await fs.writeFile(filePath, patterns[i % patterns.length]);
      }
      
      await fs.unlink(filePath);
      return { success: true, passes, fileSize };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async cleanupOrphanedFiles(dbRecords, actualFiles) {
    const dbFileIds = new Set(dbRecords.map(r => r.fileId));
    const orphanedFiles = actualFiles.filter(
      file => !dbFileIds.has(path.basename(file, path.extname(file)))
    );
    
    const results = await Promise.allSettled(
      orphanedFiles.map(file => fs.unlink(file))
    );
    
    return {
      totalOrphaned: orphanedFiles.length,
      deleted: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length
    };
  }

  static async monitorDiskUsage(thresholdGB = 10) {
    const checkDiskSpace = async (directory) => {
      const stats = await fs.statfs(directory);
      const freeGB = (stats.bavail * stats.bsize) / (1024 ** 3);
      return { freeGB, belowThreshold: freeGB < thresholdGB };
    };
    
    const directories = [
      process.env.TEMP_DIR,
      process.env.UPLOAD_DIR,
      process.env.OUTPUT_DIR
    ].filter(Boolean);
    
    const results = await Promise.all(
      directories.map(async dir => ({
        directory: dir,
        ...(await checkDiskSpace(dir))
      }))
    );
    
    const critical = results.filter(r => r.belowThreshold);
    if (critical.length > 0) {
      await this.emergencyCleanup();
    }
    
    return { results, critical };
  }

  static async emergencyCleanup() {
    // 1. Delete oldest files first
    const tempDir = path.join(process.env.TEMP_DIR, 'uploads');
    const files = (await fs.readdir(tempDir))
      .map(file => path.join(tempDir, file));
    
    const filesWithStats = await Promise.all(
      files.map(async file => ({
        file,
        stats: await fs.stat(file)
      }))
    );
    
    filesWithStats.sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);
    
    // Delete 50% of oldest files
    const toDelete = filesWithStats.slice(0, Math.floor(files.length * 0.5));
    await Promise.all(toDelete.map(f => fs.unlink(f.file)));
    
    return { deleted: toDelete.length, total: files.length };
  }

  static async cleanupExpiredSessions(sessionRecords) {
    const now = Date.now();
    const expired = sessionRecords.filter(
      session => new Date(session.expiresAt) < now
    );
    
    const fileDeletions = await Promise.allSettled(
      expired.map(session => 
        fs.unlink(session.filePath).catch(() => {})
      )
    );
    
    return {
      totalSessions: sessionRecords.length,
      expired: expired.length,
      deleted: fileDeletions.filter(r => r.status === 'fulfilled').length
    };
  }
}

// AI-Powered Storage Optimizer
export class StorageOptimizer {
  static async optimizeStorage(directory) {
    const files = await fs.readdir(directory);
    const optimizationResults = [];
    
    for (const file of files) {
      const filePath = path.join(directory, file);
      const { mime } = await fileTypeFromFile(filePath) || {};
      
      if (mime?.startsWith('image/')) {
        const optimizedPath = `${filePath}.optimized`;
        await sharp(filePath)
          .webp({ quality: 75 })
          .toFile(optimizedPath);
        
        const originalSize = (await fs.stat(filePath)).size;
        const optimizedSize = (await fs.stat(optimizedPath)).size;
        
        if (optimizedSize < originalSize * 0.9) {
          await fs.rename(optimizedPath, filePath);
          optimizationResults.push({
            file,
            originalSize,
            optimizedSize,
            savings: originalSize - optimizedSize,
            status: 'optimized'
          });
        } else {
          await fs.unlink(optimizedPath);
          optimizationResults.push({
            file,
            originalSize,
            optimizedSize,
            savings: 0,
            status: 'not_optimized'
          });
        }
      }
    }
    
    return {
      totalFiles: files.length,
      optimized: optimizationResults.filter(r => r.status === 'optimized').length,
      totalSavings: optimizationResults.reduce((sum, r) => sum + r.savings, 0),
      details: optimizationResults
    };
  }

  static async deduplicateFiles(directory) {
    const files = await fs.readdir(directory);
    const fileHashes = new Map();
    const duplicates = [];
    
    for (const file of files) {
      const filePath = path.join(directory, file);
      const hash = await CosmicFileAnalyzer.calculateQuantumHash(filePath);
      
      if (fileHashes.has(hash)) {
        duplicates.push({
          file,
          original: fileHashes.get(hash),
          path: filePath
        });
      } else {
        fileHashes.set(hash, file);
      }
    }
    
    // Keep the oldest version
    const toDelete = await Promise.all(
      duplicates.map(async dup => {
        const [originalStats, duplicateStats] = await Promise.all([
          fs.stat(path.join(directory, dup.original)),
          fs.stat(dup.path)
        ]);
        
        return originalStats.mtimeMs < duplicateStats.mtimeMs 
          ? { keep: dup.original, delete: dup.path }
          : { keep: dup.path, delete: path.join(directory, dup.original) };
      })
    );
    
    const deletionResults = await Promise.allSettled(
      toDelete.map(item => fs.unlink(item.delete))
    );
    
    return {
      totalFiles: files.length,
      unique: fileHashes.size,
      duplicates: duplicates.length,
      deleted: deletionResults.filter(r => r.status === 'fulfilled').length,
      details: duplicates
    };
  }

  static async compressDirectory(directory) {
    const zipPath = `${directory}.zip`;
    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = fs.createWriteStream(zipPath);
    
    return new Promise((resolve, reject) => {
      output.on('close', () => {
        const originalSize = archive.pointer();
        fs.stat(zipPath).then(stats => {
          resolve({
            originalPath: directory,
            zipPath,
            originalSize,
            compressedSize: stats.size,
            ratio: stats.size / originalSize
          });
        });
      });
      
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(directory, false);
      archive.finalize();
    });
  }
}