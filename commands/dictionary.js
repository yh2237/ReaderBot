const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dictionary')
        .setDescription('読み方を登録・管理します')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('単語の読み方を登録します')
                .addStringOption(option =>
                    option.setName('word')
                        .setDescription('登録する単語')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reading')
                        .setDescription('単語の読み方')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('単語の読み方を削除します')
                .addStringOption(option =>
                    option.setName('word')
                        .setDescription('削除する単語')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('登録されている辞書一覧を表示します')
        ),
    async execute(interaction, services) {
        const { db, config, guildCache } = services;
        const { guild, guildId } = interaction;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const currentCount = await db.getDictionaryEntryCount(guildId);
            if (config.dictionary_limit_per_guild && currentCount >= config.dictionary_limit_per_guild) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF6600)
                    .setDescription(`辞書の登録上限（${config.dictionary_limit_per_guild}語）に達しているため、新しい単語を追加できません。`);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            const word = interaction.options.getString('word');
            const reading = interaction.options.getString('reading');
            await db.addDictionaryEntry(guildId, word, reading);
            guildCache.delete(guildId);
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setDescription(`辞書に '${word}' -> '${reading}' を追加しました。`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (subcommand === 'remove') {
            const word = interaction.options.getString('word');
            await db.removeDictionaryEntry(guildId, word);
            guildCache.delete(guildId);
            const embed = new EmbedBuilder()
                .setColor(0xFF6600)
                .setDescription(`辞書から '${word}' を削除しました。`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (subcommand === 'list') {
            const entries = await db.getDictionaryEntries(guildId);
            if (entries.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle(`サーバー「${guild.name}」の辞書一覧`)
                    .setDescription('辞書に登録されている単語はありません。');
                return interaction.reply({ embeds: [embed] });
            }

            const lines = entries.map(entry => `\`${entry.word}\` -> \`${entry.reading}\``);
            const pages = [];
            let current = '';
            for (const line of lines) {
                if ((current + '\n' + line).length > 4000) {
                    pages.push(current);
                    current = line;
                } else {
                    current = current ? current + '\n' + line : line;
                }
            }
            if (current) pages.push(current);

            const embeds = pages.map((page, i) => {
                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setDescription(page);
                if (i === 0) embed.setTitle(`サーバー「${guild.name}」の辞書一覧 (${entries.length}語)`);
                if (pages.length > 1) embed.setFooter({ text: `ページ ${i + 1}/${pages.length}` });
                return embed;
            });

            await interaction.reply({ embeds: embeds.slice(0, 10) });
        }
    },
};
