const sqlite3 = require('sqlite3').verbose();
const { DATABASE_BOOLEAN } = require('./constants.js');
const logger = require('./logger.js');
const messages = require('./messages.js');
let db = null;

function initialize(databaseFile) {
    if (db) return;
    db = new sqlite3.Database(databaseFile);

    db.serialize(() => {
        db.run('PRAGMA journal_mode = WAL;');
        db.run(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        speaker_id TEXT,
        speed_scale REAL,
        pitch_scale REAL,
        intonation_scale REAL,
        volume_scale REAL,
        PRIMARY KEY (user_id, guild_id)
      )
    `);
        db.run(`
      CREATE TABLE IF NOT EXISTS connections (
        guild_id TEXT PRIMARY KEY,
        text_channel_id TEXT NOT NULL,
        voice_channel_id TEXT NOT NULL
      )
    `);
        db.run(`
      CREATE TABLE IF NOT EXISTS bot_stats (
        stat_name TEXT PRIMARY KEY,
        stat_value INTEGER DEFAULT 0
      )
    `);
        db.run(`
      CREATE TABLE IF NOT EXISTS guild_dictionary (
        guild_id TEXT NOT NULL,
        word TEXT NOT NULL,
        reading TEXT NOT NULL,
        PRIMARY KEY (guild_id, word)
      )
    `);
        db.run(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        auto_leave INTEGER DEFAULT ${DATABASE_BOOLEAN.TRUE}
      )
    `);
        db.run(`ALTER TABLE guild_settings ADD COLUMN join_leave_notifications INTEGER DEFAULT ${DATABASE_BOOLEAN.TRUE}`, () => { });
        db.run(`ALTER TABLE guild_settings ADD COLUMN notification_speaker_id TEXT`, () => { });
        db.run(`ALTER TABLE user_settings ADD COLUMN middle_pause INTEGER`, () => { });
        db.run(`ALTER TABLE user_settings ADD COLUMN long_pause INTEGER`, () => { });
        db.run(`ALTER TABLE user_settings ADD COLUMN sentence_pause INTEGER`, () => { });
        db.run(`UPDATE user_settings SET speaker_id = 'VOICEVOX:' || speaker_id WHERE speaker_id IS NOT NULL AND speaker_id NOT LIKE 'VOICEVOX:%' AND speaker_id NOT LIKE 'A.I.VOICE:%' AND CAST(speaker_id AS INTEGER) > 0`, () => { });
    });
    logger.success(messages.system.db_initialized(databaseFile));
}

function getGuildSettings(guildId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.get('SELECT * FROM guild_settings WHERE guild_id = ?', [guildId], (err, row) => {
            if (err) reject(err);
            else resolve(row || { guild_id: guildId, auto_leave: DATABASE_BOOLEAN.TRUE, join_leave_notifications: DATABASE_BOOLEAN.TRUE, notification_speaker_id: null });
        });
    });
}

function updateGuildSetting(guildId, key, value) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        const allowedKeys = new Set(['auto_leave', 'join_leave_notifications', 'notification_speaker_id']);
        if (!allowedKeys.has(key)) {
            return reject(new Error('Invalid guild setting key.'));
        }
        db.run('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)', [guildId], (err) => {
            if (err) return reject(err);
            const stmt = db.prepare(`UPDATE guild_settings SET ${key} = ? WHERE guild_id = ?`);
            stmt.run(value, guildId, function (err) {
                stmt.finalize();
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

function addDictionaryEntry(guildId, word, reading) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.run('INSERT OR REPLACE INTO guild_dictionary (guild_id, word, reading) VALUES (?, ?, ?)', [guildId, word, reading], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function removeDictionaryEntry(guildId, word) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.run('DELETE FROM guild_dictionary WHERE guild_id = ? AND word = ?', [guildId, word], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getDictionaryEntries(guildId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.all('SELECT word, reading FROM guild_dictionary WHERE guild_id = ?', [guildId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getDictionaryEntryCount(guildId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.get('SELECT COUNT(*) as count FROM guild_dictionary WHERE guild_id = ?', [guildId], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.count : 0);
        });
    });
}

function getStat(statName) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.get('SELECT stat_value FROM bot_stats WHERE stat_name = ?', [statName], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.stat_value : 0);
        });
    });
}

function incrementStat(statName) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.run('INSERT OR IGNORE INTO bot_stats (stat_name, stat_value) VALUES (?, 0)', [statName], (err) => {
            if (err) return reject(err);
            db.run('UPDATE bot_stats SET stat_value = stat_value + 1 WHERE stat_name = ?', [statName], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

function getUserSettings(userId, guildId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.get('SELECT * FROM user_settings WHERE user_id = ? AND guild_id = ?', [userId, guildId], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function updateUserSettings(userId, guildId, key, value) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        const allowedKeys = new Set([
            'speaker_id', 'speed_scale', 'pitch_scale', 'intonation_scale', 'volume_scale',
            'middle_pause', 'long_pause', 'sentence_pause'
        ]);
        if (!allowedKeys.has(key)) {
            return reject(new Error(`Invalid user setting key: ${key}`));
        }
        db.run('INSERT OR IGNORE INTO user_settings (user_id, guild_id) VALUES (?, ?)', [userId, guildId], (err) => {
            if (err) return reject(err);
            const stmt = db.prepare(`UPDATE user_settings SET ${key} = ? WHERE user_id = ? AND guild_id = ?`);
            stmt.run(value, userId, guildId, function (err) {
                stmt.finalize();
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

function resetUserSettings(userId, guildId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.run('UPDATE user_settings SET speaker_id = NULL, speed_scale = NULL, pitch_scale = NULL, intonation_scale = NULL, volume_scale = NULL, middle_pause = NULL, long_pause = NULL, sentence_pause = NULL WHERE user_id = ? AND guild_id = ?', [userId, guildId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function resetUserParams(userId, guildId, params) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.run(
            'INSERT OR IGNORE INTO user_settings (user_id, guild_id) VALUES (?, ?)',
            [userId, guildId],
            (err) => {
                if (err) return reject(err);
                db.run(
                    `UPDATE user_settings
                     SET speed_scale = ?, pitch_scale = ?, intonation_scale = ?, volume_scale = ?
                     WHERE user_id = ? AND guild_id = ?`,
                    [
                        params.speed_scale ?? null,
                        params.pitch_scale ?? null,
                        params.intonation_scale ?? null,
                        params.volume_scale ?? null,
                        userId,
                        guildId,
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            }
        );
    });
}

function setConnection(guildId, textChannelId, voiceChannelId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.run('INSERT OR REPLACE INTO connections (guild_id, text_channel_id, voice_channel_id) VALUES (?, ?, ?)', [guildId, textChannelId, voiceChannelId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getConnection(guildId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.get('SELECT text_channel_id, voice_channel_id FROM connections WHERE guild_id = ?', [guildId], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function deleteConnection(guildId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized.'));
        db.run('DELETE FROM connections WHERE guild_id = ?', [guildId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

module.exports = {
    initialize,
    getUserSettings,
    updateUserSettings,
    resetUserSettings,
    resetUserParams,
    setConnection,
    getConnection,
    deleteConnection,
    getStat,
    incrementStat,
    addDictionaryEntry,
    removeDictionaryEntry,
    getDictionaryEntries,
    getDictionaryEntryCount,
    getGuildSettings,
    updateGuildSetting,
};
