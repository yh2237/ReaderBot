const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { performDisconnect } = require('../utils/disconnect.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('VCから退出し、読み上げを終了します'),
    async execute(interaction, services) {
        const { connections, client, guildCache } = services;
        const { guild, guildId } = interaction;
        const connection = connections.get(guildId);

        if (!connection) {
            return interaction.reply({ content: 'どのボイスチャンネルにも参加していません', ephemeral: true });
        }
        const cachedGuild = guildCache.get(guildId);
        const voiceChannelId = cachedGuild?.connection?.voice_channel_id;
        const voiceChannelName = voiceChannelId ? guild.channels.cache.get(voiceChannelId)?.name : '不明なチャンネル';

        await performDisconnect(guildId, services, 'command');

        const leaveEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('読み上げを終了しました')
            .setDescription(`ボイスチャンネル **${voiceChannelName}** から退出しました。`);

        return interaction.reply({ embeds: [leaveEmbed] });
    },
};
