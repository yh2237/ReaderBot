const { EmbedBuilder } = require('discord.js');
const logger = require('./logger.js');
const messages = require('./messages.js');

async function performDisconnect(guildId, services, reason = '不明な理由') {
    const { connections, players, messageQueues, db, guildCache, client } = services;
    const connection = connections.get(guildId);

    if (!connection) {
        return;
    }

    try {
        const cachedGuild = guildCache.get(guildId);
        const textChannelId = cachedGuild?.connection?.text_channel_id;

        connection.destroy();
        connections.delete(guildId);
        players.delete(guildId);
        messageQueues.delete(guildId);

        await db.deleteConnection(guildId);
        guildCache.delete(guildId);

        logger.info(messages.discord.disconnected(guildId, reason));

        if (textChannelId && reason === 'auto') {
            const channel = await client.channels.fetch(textChannelId);
            if (channel) {
                const autoLeaveEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('自動退出しました')
                    .setDescription('ボイスチャンネルに誰もいなくなったため自動的に退出しました。\n自動退出の有効無効の設定は **/autoleave** コマンドで変更できます');
                await channel.send({ embeds: [autoLeaveEmbed] });
            }
        }
    } catch (error) {
        logger.error(messages.discord.disconnect_error(guildId), error);
    }
}

module.exports = { performDisconnect };
