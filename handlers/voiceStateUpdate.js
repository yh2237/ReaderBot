const { performDisconnect } = require('../utils/disconnect.js');
const { processText, escapeRegex } = require('../utils/textProcessor.js');
const { DATABASE_BOOLEAN, BOT_NOTIFICATION_ID } = require('../utils/constants.js');
const logger = require('../utils/logger.js');
const messages = require('../utils/messages.js');

function queueNotification(guildId, text, handlerObjects) {
    const { messageQueues, players, playNextMessage } = handlerObjects;
    const guildQueue = messageQueues.get(guildId);
    const player = players.get(guildId);

    if (guildQueue && player) {
        guildQueue.queue.push({ content: text, authorId: BOT_NOTIFICATION_ID });
        if (player.state.status === 'idle') {
            playNextMessage(guildId, handlerObjects);
        }
    }
}

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState, services) {
        const { connections, client, guildCache, db, config } = services;
        const guildId = oldState.guild.id;

        const connection = connections.get(guildId);
        if (!connection) return;

        let cachedGuild = guildCache.get(guildId);
        if (!cachedGuild || !cachedGuild.compiled) {
            const [dictionaryEntries, dbConnection, settings] = await Promise.all([
                db.getDictionaryEntries(guildId),
                db.getConnection(guildId),
                db.getGuildSettings(guildId)
            ]);
            let dictionaryRegex = null;
            const readingMap = new Map();
            if (dictionaryEntries.length > 0) {
                dictionaryEntries.sort((a, b) => b.word.length - a.word.length);
                const words = dictionaryEntries.map(e => escapeRegex(e.word));
                dictionaryRegex = new RegExp(`(${words.join('|')})`, 'gi');
                dictionaryEntries.forEach(e => readingMap.set(e.word.toLowerCase(), e.reading));
            }
            cachedGuild = { dictionaryRegex, readingMap, connection: dbConnection, settings, compiled: true };
            guildCache.set(guildId, cachedGuild);
        }

        const { settings } = cachedGuild;
        const botChannelId = connection.joinConfig.channelId;

        if (oldState.id === client.user.id) return;

        const userName = oldState.member?.displayName || newState.member?.displayName;
        if (!userName) return;

        const userJoined = oldState.channelId !== botChannelId && newState.channelId === botChannelId;
        const userLeft = oldState.channelId === botChannelId && newState.channelId !== botChannelId;

        if (settings.join_leave_notifications === DATABASE_BOOLEAN.TRUE && (userJoined || userLeft)) {
            const message = userJoined ? `${userName}さんが入室しました` : `${userName}さんが退出しました`;
            const notificationConfig = { ...config, max_message_length: 100 };
            const processedMessage = processText(message, cachedGuild, notificationConfig)
                .replace(/:[^:]+:|<[^>]+>/g, '');

            queueNotification(guildId, processedMessage, services);
        }

        if (userLeft && settings.auto_leave === DATABASE_BOOLEAN.TRUE) {
            const channel = oldState.channel;
            if (channel && channel.members.size === 1) {
                logger.info(messages.discord.alone_disconnect(channel.name));
                setTimeout(() => performDisconnect(guildId, services, 'auto'), 1000);
            }
        }
    },
};
