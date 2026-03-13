const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('showconfig')
        .setDescription('現在の読み上げ設定を表示します'),
    async execute(interaction, services) {
        const { db, config, client } = services;
        const { user, guild, guildId } = interaction;

        const settings = await db.getUserSettings(user.id, guildId);
        const currentSpeakerId = settings?.speaker_id ?? null;
        const isAiVoice = typeof currentSpeakerId === 'string' && currentSpeakerId.startsWith('A.I.VOICE:');

        const cfgDefaults = isAiVoice
            ? config.aivoice?.default_params
            : config.voicevox?.default_params;
        const defaultSpeakerId = isAiVoice
            ? (config.aivoice?.default_voice_preset || '')
            : (config.voicevox?.default_speaker_id || 1);
        const defaults = {
            speaker_id: defaultSpeakerId,
            speed_scale: cfgDefaults?.speed_scale ?? 1.0,
            pitch_scale: cfgDefaults?.pitch_scale ?? (isAiVoice ? 1.0 : 0.0),
            intonation_scale: cfgDefaults?.intonation_scale ?? 1.0,
            volume_scale: cfgDefaults?.volume_scale ?? 1.0,
        };
        const displaySpeakerId = currentSpeakerId ?? defaults.speaker_id;

        let speakerName = `不明なID (${displaySpeakerId})`;
        for (const charName in client.speakers) {
            const style = client.speakers[charName].find(s => s.id === displaySpeakerId);
            if (style) {
                speakerName = `${charName} (${style.styleName})`;
                break;
            }
        }

        const configEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setAuthor({ name: `${user.username} の設定`, iconURL: user.displayAvatarURL() })
            .setTitle(`サーバー「${guild.name}」での読み上げ設定`)
            .addFields(
                { name: '話者', value: `\`${speakerName}\``, inline: false },
                { name: '音量', value: `\`${settings?.volume_scale ?? defaults.volume_scale}\``, inline: true },
                { name: '話速', value: `\`${settings?.speed_scale ?? defaults.speed_scale}\``, inline: true },
                { name: '声の高さ', value: `\`${settings?.pitch_scale ?? defaults.pitch_scale}\``, inline: true },
                { name: '抑揚', value: `\`${settings?.intonation_scale ?? defaults.intonation_scale}\``, inline: true },
                ...(isAiVoice ? [
                    { name: '短ポーズ', value: `\`${settings?.middle_pause ?? 150} ms\``, inline: true },
                    { name: '長ポーズ', value: `\`${settings?.long_pause ?? 370} ms\``, inline: true },
                    { name: '文末ポーズ', value: `\`${settings?.sentence_pause ?? 800} ms\``, inline: true },
                ] : [])
            )
            .setTimestamp();

        return interaction.reply({ embeds: [configEmbed] });
    },
};
