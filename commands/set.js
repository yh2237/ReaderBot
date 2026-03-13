const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set')
        .setDescription('読み上げに関する設定を行います')
        .addSubcommand(subcommand =>
            subcommand
                .setName('speaker')
                .setDescription('話者を設定します'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('parameter')
                .setDescription('話者のパラメータを設定します（音量・話速・高さ・抑揚）'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('pause')
                .setDescription('ポーズの長さを設定します（短ポーズ・長ポーズ・文末ポーズ）【A.I.VOICE専用】')),
    async execute(interaction, services) {
        const { db, client, config } = services;
        const subCommand = interaction.options.getSubcommand();
        const { user, guildId } = interaction;

        const currentSettings = await db.getUserSettings(user.id, guildId);
        const currentSpeakerId = currentSettings?.speaker_id ?? '';
        const isAiVoice = typeof currentSpeakerId === 'string' && currentSpeakerId.startsWith('A.I.VOICE:');

        if (subCommand === 'speaker') {
            const { useVoicevox, useAiVoice } = services;

            if (useVoicevox && useAiVoice) {
                const engineSelect = new StringSelectMenuBuilder()
                    .setCustomId('select_engine')
                    .setPlaceholder('エンジンを選択')
                    .addOptions([
                        { label: 'VOICEVOX', value: 'VOICEVOX' },
                        { label: 'A.I.VOICE', value: 'A.I.VOICE' },
                    ]);
                const row = new ActionRowBuilder().addComponents(engineSelect);
                return interaction.reply({ content: 'エンジンを選択してください', components: [row], ephemeral: true });
            }

            const prefix = useAiVoice ? 'A.I.VOICE' : 'VOICEVOX';
            const characterNames = Object.keys(client.speakers).filter(n => n.startsWith(prefix + ':'));
            if (characterNames.length === 0) {
                return interaction.reply({ content: '話者リストが利用できません', ephemeral: true });
            }
            const options = characterNames.slice(0, 25).map(name => ({ label: name.slice(prefix.length + 2), value: name }));
            const characterSelect = new StringSelectMenuBuilder()
                .setCustomId('select_character')
                .setPlaceholder('キャラクターを選択')
                .addOptions(options);
            const row = new ActionRowBuilder().addComponents(characterSelect);
            return interaction.reply({ content: 'キャラクターを選択してください', components: [row], ephemeral: true });
        }

        if (subCommand === 'parameter') {
            const settings = currentSettings;
            const cfgDefaults = isAiVoice
                ? config.aivoice?.default_params
                : config.voicevox?.default_params;
            const defaults = {
                speed_scale: cfgDefaults?.speed_scale ?? (isAiVoice ? 1.0 : 1.0),
                pitch_scale: cfgDefaults?.pitch_scale ?? (isAiVoice ? 1.0 : 0.0),
                intonation_scale: cfgDefaults?.intonation_scale ?? 1.0,
                volume_scale: cfgDefaults?.volume_scale ?? 1.0,
            };
            const pitchLabel = isAiVoice ? '声の高さ (0.0 ~ 2.0)' : '声の高さ (-0.15 ~ 0.15)';
            const volumeLabel = isAiVoice ? '音量 (0.0 ~ 5.0)' : '音量 (0.0 ~ 10.0)';
            const speedLabel = isAiVoice ? '話速 (0.0 ~ 4.0)' : '話速 (0.5 ~ 2.0)';
            const intonationLabel = '抑揚 (0.0 ~ 2.0)';
            const modalId = isAiVoice ? 'ttsConfigModal_aivoice' : 'ttsConfigModal_voicevox';
            const modal = new ModalBuilder().setCustomId(modalId).setTitle('パラメータ設定');
            const createInput = (id, label, value) => new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setValue(String(value));

            modal.addComponents(
                new ActionRowBuilder().addComponents(createInput('volumeScaleInput', volumeLabel, settings?.volume_scale ?? defaults.volume_scale)),
                new ActionRowBuilder().addComponents(createInput('speedScaleInput', speedLabel, settings?.speed_scale ?? defaults.speed_scale)),
                new ActionRowBuilder().addComponents(createInput('pitchScaleInput', pitchLabel, settings?.pitch_scale ?? defaults.pitch_scale)),
                new ActionRowBuilder().addComponents(createInput('intonationScaleInput', intonationLabel, settings?.intonation_scale ?? defaults.intonation_scale)),
            );
            return interaction.showModal(modal);
        }

        if (subCommand === 'pause') {
            if (!isAiVoice) {
                return interaction.reply({ content: 'ポーズ設定は A.I.VOICE エンジン使用時のみ利用できます。', ephemeral: true });
            }
            const settings = currentSettings;
            const modal = new ModalBuilder().setCustomId('aivoicePauseModal').setTitle('ポーズ設定');
            const createInput = (id, label, value) => new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setValue(String(value));

            modal.addComponents(
                new ActionRowBuilder().addComponents(createInput('middlePauseInput', '短ポーズ (80 ~ 500 ms)', settings?.middle_pause ?? 150)),
                new ActionRowBuilder().addComponents(createInput('longPauseInput', '長ポーズ (80 ~ 2000 ms)', settings?.long_pause ?? 370)),
                new ActionRowBuilder().addComponents(createInput('sentencePauseInput', '文末ポーズ (0 ~ 10000 ms)', settings?.sentence_pause ?? 800)),
            );
            return interaction.showModal(modal);
        }
    },
};
