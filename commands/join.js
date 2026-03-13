const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus, createAudioPlayer, AudioPlayerStatus } = require('@discordjs/voice');
const logger = require('../utils/logger.js');
const { escapeRegex } = require('../utils/textProcessor.js');
const messages = require('../utils/messages.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('VCに参加し、読み上げを開始します'),
    async execute(interaction, services) {
        const { connections, players, messageQueues, db, config, playNextMessage, warmup, voicevoxEngines, userSettingsCache, guildCache } = services;
        const { guild, guildId, member, channel: textChannel } = interaction;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: 'ボイスチャンネルに接続してからコマンドを実行してください', ephemeral: true });
        }
        if (connections.has(guildId)) {
            return interaction.reply({ content: '既に別のチャンネルで読み上げ中です', ephemeral: true });
        }

        connections.set(guildId, null);

        await interaction.deferReply();

        const warmupPromise = (async () => {
            logger.debug(messages.discord.join_warmup_start);
            warmup(services).catch(err => logger.debug(messages.discord.join_warmup_error(err.message)));

            try {
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
                return { dictionaryRegex, readingMap, settings };
            } catch (err) {
                logger.debug(messages.discord.preload_error(err.message));
                return null;
            }
        })();

        let connection;
        try {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guildId,
                adapterCreator: guild.voiceAdapterCreator,
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 5_000);

            const player = createAudioPlayer();
            connection.subscribe(player);

            player.on(AudioPlayerStatus.Idle, () => {
                playNextMessage(guildId, services);
            });

            player.on('error', (error) => {
                logger.error(messages.discord.player_error(guildId), error);
                playNextMessage(guildId, services);
            });

            connections.set(guildId, connection);
            players.set(guildId, player);
            messageQueues.set(guildId, { queue: [] });
            await db.setConnection(guildId, textChannel.id, voiceChannel.id);

            const preloadedData = await warmupPromise;
            if (preloadedData) {
                const connectionData = { text_channel_id: textChannel.id, voice_channel_id: voiceChannel.id };
                const cachedGuild = {
                    ...preloadedData,
                    connection: connectionData,
                    compiled: true
                };
                guildCache.set(guildId, cachedGuild);
                logger.debug(messages.discord.cache_prewarmed(guildId));
            } else {
                guildCache.delete(guildId);
            }

            const joinEmbed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('読み上げを開始します')
                .setDescription(`ボイスチャンネル **${voiceChannel.name}** で、このテキストチャンネルのメッセージを読み上げます。\n終了するには \`/leave\` コマンドを実行してください。\n話者やパラメータの設定は \`/help\` をご確認ください。`);

            return interaction.editReply({ embeds: [joinEmbed] });

        } catch (error) {
            if (connection) {
                try { connection.destroy(); } catch { /* うへ */ }
            }
            connections.delete(guildId);
            players.delete(guildId);
            messageQueues.delete(guildId);
            logger.error(messages.discord.join_failed, error);
            return interaction.editReply({ content: 'ボイスチャンネルへの接続に失敗しました (´・ω・｀)' });
        }
    },
};
