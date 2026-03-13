const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { DATABASE_BOOLEAN } = require('../utils/constants.js');
const logger = require('../utils/logger.js');
const messages = require('../utils/messages.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoleave')
        .setDescription('VCにBotだけになった際の自動退出の有効無効を設定します')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('自動退出を有効にするか無効にするか')
                .setRequired(true)),
    async execute(interaction, services) {
        const { db, guildCache } = services;
        const { guildId } = interaction;
        const enabled = interaction.options.getBoolean('enabled');

        try {
            await db.updateGuildSetting(guildId, 'auto_leave', enabled ? DATABASE_BOOLEAN.TRUE : DATABASE_BOOLEAN.FALSE);
            guildCache.delete(guildId);
            const status = enabled ? '有効' : '無効';
            const color = enabled ? 0x0099FF : 0xFF6600;
            const embed = new EmbedBuilder()
                .setColor(color)
                .setDescription(`自動退出を **${status}** に設定しました。`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            logger.error(messages.errors.update_autoleave_failed, error);
            await interaction.reply({
                content: '設定の更新中にエラーが発生しました。',
                ephemeral: true,
            });
        }
    },
};
