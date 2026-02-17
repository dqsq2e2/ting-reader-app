import { Directory, Filesystem, type FileInfo } from '@capacitor/filesystem';
import { CapacitorHttp } from '@capacitor/core';

// Use 'EXTERNAL' to map to Directory.External (Publicly visible in Android/data, accessible by MediaPlayer)
const DATA_DIR = Directory.External;

// Cache configuration
const MAX_CACHE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB limit
const MAX_FILES = 50; // 50 files limit
const CACHE_DIR = 'media_cache';

interface ExtendedFileInfo extends FileInfo {
  name: string;
}

interface CacheStats {
  size: number;
  files: ExtendedFileInfo[];
}

// Track active downloads for logging only
const activeDownloads = new Set<string>();

/**
 * Check if file is cached
 */
export async function getCachedFile(fileName: string): Promise<string | null> {
    try {
        const stat = await Filesystem.stat({
            path: `${CACHE_DIR}/${fileName}`,
            directory: DATA_DIR
        });
        
        // Check if file size is valid (greater than 0)
        // Some failed downloads might leave empty files
        if (stat.size === 0) {
            console.warn(`[Cache] Found empty file for ${fileName}, ignoring.`);
            // Optionally delete it so we can re-download
            try {
                await Filesystem.deleteFile({
                    path: `${CACHE_DIR}/${fileName}`,
                    directory: DATA_DIR
                });
            } catch {
                void 0;
            }
            return null;
        }

        return stat.uri;
    } catch {
        return null;
    }
}

export async function removeCachedFile(fileName: string): Promise<boolean> {
    try {
        await Filesystem.deleteFile({
            path: `${CACHE_DIR}/${fileName}`,
            directory: DATA_DIR
        });
        console.log(`[Cache] Successfully deleted ${fileName}`);
        return true;
    } catch (err) {
        // If file doesn't exist, it's considered "deleted"
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('not found')) {
            return true;
        }
        console.warn(`[Cache] Failed to delete ${fileName}:`, err);
        return false;
    }
}

/**
 * Get cache stats
 */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    try {
        await Filesystem.readdir({
            path: CACHE_DIR,
            directory: DATA_DIR
        });
    } catch {
        await Filesystem.mkdir({
            path: CACHE_DIR,
            directory: DATA_DIR,
            recursive: true
        });
        return { size: 0, files: [] };
    }

    const result = await Filesystem.readdir({
      path: CACHE_DIR,
      directory: DATA_DIR
    });

    const files = result.files;
    let totalSize = 0;
    const validFiles: ExtendedFileInfo[] = [];

    for (const file of files) {
        // Skip temp files in stats
        if (file.name.endsWith('.tmp')) continue;

        try {
            const stat = await Filesystem.stat({
                path: `${CACHE_DIR}/${file.name}`,
                directory: DATA_DIR
            });
            
            validFiles.push({
                name: file.name,
                size: stat.size,
                mtime: stat.mtime,
                uri: stat.uri,
                type: file.type,
                ctime: stat.ctime
            });
            totalSize += Number(stat.size);
        } catch (e) {
            console.warn(`Failed to stat file ${file.name}`, e);
        }
    }

    return { size: totalSize, files: validFiles };
  } catch (e) {
    console.error('Failed to get cache stats:', e);
    return { size: 0, files: [] };
  }
}

/**
 * Ensure cache limits (LRU)
 */
export async function ensureCacheLimits() {
  try {
    const { size, files } = await getCacheStats();

    if (size > MAX_CACHE_SIZE_BYTES || files.length > MAX_FILES) {
      console.log(`Cache cleanup: Size=${(size / 1024 / 1024).toFixed(2)}MB, Files=${files.length}`);

      files.sort((a, b) => (a.mtime || 0) - (b.mtime || 0));

      let currentSize = size;
      const filesToDelete: ExtendedFileInfo[] = [];

      if (files.length > MAX_FILES) {
        const countToDelete = files.length - MAX_FILES;
        const deletedByCount = files.splice(0, countToDelete);
        filesToDelete.push(...deletedByCount);
        deletedByCount.forEach(f => currentSize -= (Number(f.size) || 0));
      }

      for (const file of files) {
        if (currentSize <= MAX_CACHE_SIZE_BYTES) break;
        filesToDelete.push(file);
        currentSize -= (Number(file.size) || 0);
      }

      for (const file of filesToDelete) {
        await Filesystem.deleteFile({
            path: `${CACHE_DIR}/${file.name}`,
            directory: DATA_DIR
        });
      }
      
      console.log(`Deleted ${filesToDelete.length} files to free up space.`);
    }
  } catch (err) {
    console.error('Cache cleanup failed:', err);
  }
}

/**
 * Download file to cache (Atomic + Chunked + Cancellable)
 */
export async function downloadToCache(url: string, fileName: string): Promise<string> {
    const tempFileName = `${fileName}.tmp`;
    
    try {
        console.log(`[Cache] Starting download for ${fileName}`);
        activeDownloads.add(fileName);
        
        // Ensure dir exists
        try {
            await Filesystem.readdir({ path: CACHE_DIR, directory: DATA_DIR });
        } catch {
            await Filesystem.mkdir({ path: CACHE_DIR, directory: DATA_DIR, recursive: true });
        }

        // 1. Head request for size
        const headResponse = await CapacitorHttp.request({
            method: 'HEAD',
            url: url
        });
        
        const headers = headResponse.headers;
        const contentLength = headers['Content-Length'] || headers['content-length'];
        const totalSize = parseInt(contentLength || '0');

        // Clean up any existing temp file
        try {
            await Filesystem.deleteFile({
                path: `${CACHE_DIR}/${tempFileName}`,
                directory: DATA_DIR
            });
        } catch {
            void 0;
        }

        if (totalSize > 0 && totalSize > 50 * 1024 * 1024) {
            // Only use chunking for very large files (> 50MB) to avoid OOM
            // Most audio chapters are 10-30MB, which CapacitorHttp can handle in one go
            console.log(`Downloading ${fileName} (temp) in chunks. Total: ${totalSize}`);
            const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
            let offset = 0;

            while (offset < totalSize) {
                const end = Math.min(offset + CHUNK_SIZE - 1, totalSize - 1);
                const response = await CapacitorHttp.get({
                    url: url,
                    headers: { Range: `bytes=${offset}-${end}` },
                    responseType: 'blob'
                });

                if (response.status >= 400) {
                    throw new Error(`Download chunk failed: ${response.status}`);
                }
                
                // response.data is Base64 string. 
                // Filesystem.appendFile with no encoding writes binary from Base64.
                if (offset === 0) {
                    await Filesystem.writeFile({
                        path: `${CACHE_DIR}/${tempFileName}`,
                        data: response.data,
                        directory: DATA_DIR,
                        recursive: true
                    });
                } else {
                    await Filesystem.appendFile({
                        path: `${CACHE_DIR}/${tempFileName}`,
                        data: response.data,
                        directory: DATA_DIR
                    });
                }
                
                offset += CHUNK_SIZE;
            }
        } else {
            // Single file download for standard size files
            // This is safer and faster for typical audio files
            console.log(`Downloading ${fileName} (temp) single file...`);
             
            const response = await CapacitorHttp.get({
                url: url,
                responseType: 'blob'
            });
            
            if (response.status !== 200) throw new Error(`Download failed: ${response.status}`);

            // response.data is Base64 string. 
            // Filesystem.writeFile with no encoding writes binary from Base64.
            await Filesystem.writeFile({
                path: `${CACHE_DIR}/${tempFileName}`,
                data: response.data,
                directory: DATA_DIR,
                recursive: true
            });
        }

        // Atomic Rename
        await Filesystem.rename({
            from: `${CACHE_DIR}/${tempFileName}`,
            to: `${CACHE_DIR}/${fileName}`,
            directory: DATA_DIR,
            toDirectory: DATA_DIR
        });

        // Check limits
        ensureCacheLimits().catch(console.error);
        activeDownloads.delete(fileName);

        const uri = await Filesystem.getUri({
            path: `${CACHE_DIR}/${fileName}`,
            directory: DATA_DIR
        });
        return uri.uri;

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to download ${fileName}:`, message);
        // Cleanup temp
        try {
            await Filesystem.deleteFile({
                path: `${CACHE_DIR}/${tempFileName}`,
                directory: DATA_DIR
            });
        } catch {
            void 0;
        }
        
        activeDownloads.delete(fileName);
        throw err;
    }
}

/**
 * Clear cache
 */
export async function clearCache() {
  try {
    await Filesystem.rmdir({
        path: CACHE_DIR,
        directory: DATA_DIR,
        recursive: true
    });
    return true;
  } catch {
    return false;
  }
}

export async function getCacheDir() {
    const uri = await Filesystem.getUri({
        path: CACHE_DIR,
        directory: DATA_DIR
    });
    return uri.uri;
}

export const mobileCacheManager = {
    getCachedFile,
    removeCachedFile,
    getCacheStats,
    ensureCacheLimits,
    downloadToCache,
    clearCache,
    getCacheDir
};
