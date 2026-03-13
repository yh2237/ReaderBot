const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('notifyspeaker')
        .setDescription('入退室通知の話者をサーバーごとに設定します')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction, services) {
        const { client } = services;
        const { useVoicevox, useAiVoice } = services;

        if (useVoicevox && useAiVoice) {
            const engineSelect = new StringSelectMenuBuilder()
                .setCustomId('notify_select_engine')
                .setPlaceholder('エンジンを選択')
                .addOptions([
                    { label: 'VOICEVOX', value: 'VOICEVOX' },
                    { label: 'A.I.VOICE', value: 'A.I.VOICE' },
                ]);
            const row = new ActionRowBuilder().addComponents(engineSelect);
            return interaction.reply({ content: '通知話者のエンジンを選択してください', components: [row], ephemeral: true });
        }

        const prefix = useAiVoice ? 'A.I.VOICE' : 'VOICEVOX';
        const characterNames = Object.keys(client.speakers).filter(n => n.startsWith(prefix + ': '));
        if (characterNames.length === 0) {
            return interaction.reply({ content: '話者リストが利用できません', ephemeral: true });
        }
        const options = characterNames.slice(0, 25).map(name => ({
            label: name.slice(prefix.length + 2),
            value: name,
        }));
        const characterSelect = new StringSelectMenuBuilder()
            .setCustomId('notify_select_character')
            .setPlaceholder('キャラクターを選択')
            .addOptions(options);
        const row = new ActionRowBuilder().addComponents(characterSelect);
        return interaction.reply({ content: '通知話者のキャラクターを選択してください', components: [row], ephemeral: true });
    },
};
