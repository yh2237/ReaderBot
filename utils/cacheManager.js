const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger.js');
const messages = require('./messages.js');

async function pruneCache(cacheDir, limit) {
    if (!limit || limit <= 0) return;

    try {
        await fs.ensureDir(cacheDir);
        const files = await fs.readdir(cacheDir);

        if (files.length <= limit) {
            return;
        }

        logger.debug(messages.cache.pruning(files.length, limit));

        const fileStats = await Promise.all(files.map(async file => {
            const filePath = path.join(cacheDir, file);
            const stats = await fs.stat(filePath);
            return { file, time: stats.mtime.getTime() };
        }));

        fileStats.sort((a, b) => a.time - b.time);

        const deleteCount = files.length - limit;
        const filesToDelete = fileStats.slice(0, deleteCount);

        for (const item of filesToDelete) {
            await fs.remove(path.join(cacheDir, item.file));
        }

        logger.info(messages.cache.pruned(deleteCount));
    } catch (error) {
        logger.error(messages.cache.prune_failed, error);
    }
}

module.exports = { pruneCache };
