const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');
const logger = require('./logger.js');
const messages = require('./messages.js');

function scheduleBackup(config) {
    if (!config.backup || !config.backup.enabled) {
        logger.info(messages.backup.disabled);
        return;
    }

    const { interval_minutes, destination, retention_count } = config.backup;
    const dbPath = config.database_file;

    if (!interval_minutes || !destination || !retention_count) {
        logger.error(messages.backup.incomplete_config);
        return;
    }

    logger.info(messages.backup.scheduled(interval_minutes));
    logger.info(messages.backup.destination(destination));
    logger.info(messages.backup.retention(retention_count));

    cron.schedule(`*/${interval_minutes} * * * *`, async () => {
        try {
            logger.info(messages.backup.start);

            await fs.ensureDir(destination);

            const timestamp = new Date().toISOString().replace(/:/g, '-');
            const backupFileName = `backup-${timestamp}.db`;
            const backupFilePath = path.join(destination, backupFileName);
            await fs.copy(dbPath, backupFilePath);
            logger.success(messages.backup.success(backupFilePath));

            const files = await fs.readdir(destination);
            const backups = files
                .filter(file => file.startsWith('backup-') && file.endsWith('.db'))
                .sort()
                .reverse();

            if (backups.length > retention_count) {
                const backupsToDelete = backups.slice(retention_count);
                for (const backupToDelete of backupsToDelete) {
                    const filePathToDelete = path.join(destination, backupToDelete);
                    await fs.remove(filePathToDelete);
                    logger.info(messages.backup.removed_old(filePathToDelete));
                }
            }
        } catch (error) {
            logger.error(messages.backup.failed, error);
        }
    });
}

module.exports = { scheduleBackup };
