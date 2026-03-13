const { AudioPlayerStatus } = require('@discordjs/voice');
const db = require('../utils/database.js');
const { processText, escapeRegex } = require('../utils/textProcessor.js');
const logger = require('../utils/logger.js');

module.exports = {
    name: 'messageCreate',
    async execute(message, services) {
        const { messageQueues, players, config, db, userSettingsCache, guildCache, playNextMessage, prefetchMessages } = services;

        if (message.author.bot || !message.guild) return;
        const { guildId, channelId, content: rawContent, author } = message;

        let cachedGuild = guildCache.get(guildId);
        if (!cachedGuild || !cachedGuild.compiled) {
            const [dictionaryEntries, connection, settings] = await Promise.all([
                db.getDictionaryEntries(guildId),
                db.getConnection(guildId),
                db.getGuildSettings(guildId)
            ]);

            let dictionaryRegex = null;
            const readingMap = new Map();

            if (dictionaryEntries.length > 0) {
                dictionaryEntries.sort((a, b) => b.word.length - a.word.length);

                const words = [];
                for (const entry of dictionaryEntries) {
                    words.push(escapeRegex(entry.word));
                    readingMap.set(entry.word.toLowerCase(), entry.reading);
                }
                dictionaryRegex = new RegExp(`(${words.join('|')})`, 'gi');
            }

            cachedGuild = { dictionaryRegex, readingMap, connection, settings, compiled: true };
            guildCache.set(guildId, cachedGuild);
        }

        const { connection: connectionState } = cachedGuild;

        if (!connectionState || channelId !== connectionState.text_channel_id) {
            return;
        }

        const processStart = process.hrtime.bigint();
        const content = processText(rawContent, cachedGuild, config);
        const processEnd = process.hrtime.bigint();
        logger.debug(`processText latency: ${Number(processEnd - processStart) / 1e6}ms`);

        if (!content) return;

        const guildQueue = messageQueues.get(guildId);
        const player = players.get(guildId);
        if (guildQueue && player) {
            let settingsPromise = null;
            if (author.id) {
                const cachedSettings = userSettingsCache.get(guildId)?.get(author.id);
                if (!cachedSettings) {
                    settingsPromise = db.getUserSettings(author.id, guildId);
                }
            }

            guildQueue.queue.push({ content, authorId: author.id, settingsPromise });
            if (player.state.status === AudioPlayerStatus.Idle) {
                playNextMessage(guildId, services);
            } else if (guildQueue.queue.length === 1) {
                prefetchMessages(guildId, services);
            }
        }
    },
};
