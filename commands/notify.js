const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { DATABASE_BOOLEAN } = require('../utils/constants.js');
const logger = require('../utils/logger.js');
const messages = require('../utils/messages.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('notify')
        .setDescription('VCへのユーザーの入退室を通知するか設定します')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('入退室通知を有効にするか無効にするか')
                .setRequired(true)),
    async execute(interaction, services) {
        const { db, guildCache } = services;
        const { guildId } = interaction;
        const enabled = interaction.options.getBoolean('enabled');

        try {
            await db.updateGuildSetting(guildId, 'join_leave_notifications', enabled ? DATABASE_BOOLEAN.TRUE : DATABASE_BOOLEAN.FALSE);
            guildCache.delete(guildId);

            const status = enabled ? '有効' : '無効';
            await interaction.reply({
                content: `入退室通知機能を **${status}** に設定しました。`,
                ephemeral: true,
            });
        } catch (error) {
            logger.error(messages.errors.update_notification_failed, error);
            await interaction.reply({
                content: '設定の更新中にエラーが発生しました。',
                ephemeral: true,
            });
        }
    },
};
