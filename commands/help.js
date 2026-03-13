const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('ヘルプを表示します'),
    async execute(interaction, { db, config, speakerList, useVoicevox, useAiVoice }) {
        const defaultEngine = (config.default_engine || 'voicevox').toLowerCase();
        let engineLabel;
        if (useVoicevox && useAiVoice) {
            engineLabel = 'VOICEVOX + A.I.VOICE';
        } else if (useAiVoice) {
            engineLabel = 'A.I.VOICE';
        } else {
            engineLabel = 'VOICEVOX';
        }
        const footerText = `音声合成に ${engineLabel} を使用してますわよ`;
        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Help')
            .setDescription(`利用可能なコマンド`)
            .addFields(
                { name: '`/help`', value: 'ヘルプを表示します' },
                { name: '`/join`', value: 'VCに参加し、読み上げを開始します' },
                { name: '`/leave`', value: 'VCから退出し、読み上げを終了します' },
                { name: '`/set speaker`', value: '話者を設定します' },
                { name: '`/set parameter`', value: '話者のパラメータを設定します（音量・話速・高さ・抑揚）' },
                { name: '`/set pause`', value: 'ポーズの長さを設定します【A.I.VOICE専用】' },
                { name: '`/showconfig`', value: '現在の読み上げ設定を表示します' },
                { name: '`/dictionary add [] []`', value: '単語の読み方を登録します' },
                { name: '`/dictionary remove [単語]`', value: '単語の読み方を削除します' },
                { name: '`/dictionary list`', value: '登録されている辞書一覧を表示します' },
                { name: '`/status`', value: 'Botの現在の稼働状況を表示します' }
            )
            .setTimestamp()
            .setFooter({ text: footerText });

        await interaction.reply({ embeds: [helpEmbed] });
    },
};