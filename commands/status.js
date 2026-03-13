const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Botの現在の稼働状況を表示します'),
    async execute(interaction, services) {
        const { client, db, voicevoxEngines, connections } = services;

        await interaction.deferReply();

        const totalMessagesRead = await db.getStat('totalMessagesRead');
        const guildsJoined = client.guilds.cache.size;
        const guildsActive = connections.size;
        const botPing = client.ws.ping;

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Bot ステータス')
            .addFields(
                { name: 'Ping', value: `${botPing}ms`, inline: true },
                { name: '総読み上げ数', value: `${totalMessagesRead}`, inline: true },
                { name: '導入サーバー数', value: `${guildsJoined}`, inline: true },
                { name: '読み上げ中サーバー数', value: `${guildsActive}`, inline: true },
            );
        await interaction.editReply({ embeds: [embed] });
    },
};
