const { InteractionType, StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/database.js');
const logger = require('../utils/logger.js');
const messages = require('../utils/messages.js');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, services) {
        const { client, userSettingsCache } = services;

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            try {
                await command.execute(interaction, services);
            } catch (error) {
                logger.error(messages.errors.command_execution(interaction.commandName), error);
                const replyOptions = { content: 'コマンド実行中にエラーが発生しました (´・ω・｀)', ephemeral: true };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(replyOptions).catch(logger.error);
                }
                else {
                    await interaction.reply(replyOptions).catch(logger.error);
                }
            }
        }
        else if (interaction.isStringSelectMenu()) {
            const { customId, values, user, guildId, channel } = interaction;
            const { db } = services;
            if (customId === 'select_engine') {
                const prefix = values[0];
                const characterNames = Object.keys(client.speakers).filter(n => n.startsWith(prefix + ': '));
                if (characterNames.length === 0) {
                    return interaction.update({ content: '話者リストが利用できません (´・ω・｀)', components: [] });
                }
                const options = characterNames.slice(0, 25).map(name => ({
                    label: name.slice(prefix.length + 2),
                    value: name,
                }));
                const characterSelect = new StringSelectMenuBuilder()
                    .setCustomId('select_character')
                    .setPlaceholder('キャラクターを選択')
                    .addOptions(options);
                await interaction.update({ content: `${prefix} のキャラクターを選択してください`, components: [new ActionRowBuilder().addComponents(characterSelect)] });
            }
            else if (customId === 'select_character') {
                const styles = client.speakers[values[0]];
                if (!styles) return interaction.update({ content: 'キャラクタースタイルが見つかりませんでした (´・ω・｀)', components: [] });
                const styleSelect = new StringSelectMenuBuilder().setCustomId('select_style').setPlaceholder('スタイルを選択').addOptions(styles.map(s => ({ label: s.styleName, value: String(s.id) })));
                await interaction.update({ content: `「${values[0]}」のスタイルを選択してください`, components: [new ActionRowBuilder().addComponents(styleSelect)] });
            }
            else if (customId === 'select_style') {
                const { config } = services;
                const newSpeakerId = values[0];
                const newEngine = newSpeakerId.startsWith('A.I.VOICE:') ? 'aivoice' : 'voicevox';

                const currentSettings = await db.getUserSettings(user.id, guildId);
                const oldSpeakerId = currentSettings?.speaker_id ?? null;
                const oldEngine = (typeof oldSpeakerId === 'string' && oldSpeakerId.startsWith('A.I.VOICE:'))
                    ? 'aivoice' : 'voicevox';
                const engineChanged = newEngine !== oldEngine;

                await db.updateUserSettings(user.id, guildId, 'speaker_id', newSpeakerId);

                if (engineChanged) {
                    const defaultParams = (newEngine === 'aivoice')
                        ? config.aivoice?.default_params
                        : config.voicevox?.default_params;
                    await db.resetUserParams(user.id, guildId, {
                        speed_scale: defaultParams?.speed_scale ?? null,
                        pitch_scale: defaultParams?.pitch_scale ?? null,
                        intonation_scale: defaultParams?.intonation_scale ?? null,
                        volume_scale: defaultParams?.volume_scale ?? null,
                    });
                }

                const userCache = userSettingsCache.get(guildId);
                if (userCache) userCache.delete(user.id);

                let speakerName = Object.entries(client.speakers).flatMap(([cn, ss]) => ss.map(s => ({ ...s, charName: cn }))).find(s => s.id === newSpeakerId);
                speakerName = speakerName ? `${speakerName.charName} (${speakerName.styleName})` : '不明';
                await interaction.update({ content: '設定を更新しました', components: [] });
                const engineChangedNote = engineChanged ? '\nパラメータをエンジンの初期値にリセットしました。' : '';
                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setAuthor({ name: `${user.username} が話者を **${speakerName}** に設定しました。${engineChangedNote}`, iconURL: user.displayAvatarURL() });
                await channel.send({ embeds: [embed] });
            }
            else if (customId === 'notify_select_engine') {
                const prefix = values[0];
                const characterNames = Object.keys(client.speakers).filter(n => n.startsWith(prefix + ': '));
                if (characterNames.length === 0) {
                    return interaction.update({ content: '話者リストが利用できません (´・ω・｀)', components: [] });
                }
                const options = characterNames.slice(0, 25).map(name => ({
                    label: name.slice(prefix.length + 2),
                    value: name,
                }));
                const characterSelect = new StringSelectMenuBuilder()
                    .setCustomId('notify_select_character')
                    .setPlaceholder('キャラクターを選択')
                    .addOptions(options);
                await interaction.update({ content: `${prefix} のキャラクターを選択してください`, components: [new ActionRowBuilder().addComponents(characterSelect)] });
            }
            else if (customId === 'notify_select_character') {
                const styles = client.speakers[values[0]];
                if (!styles) return interaction.update({ content: 'キャラクタースタイルが見つかりませんでした (´・ω・｀)', components: [] });
                const styleSelect = new StringSelectMenuBuilder()
                    .setCustomId('notify_select_style')
                    .setPlaceholder('スタイルを選択')
                    .addOptions(styles.map(s => ({ label: s.styleName, value: String(s.id) })));
                await interaction.update({ content: `「${values[0]}」のスタイルを選択してください`, components: [new ActionRowBuilder().addComponents(styleSelect)] });
            }
            else if (customId === 'notify_select_style') {
                const newSpeakerId = values[0];
                await db.updateGuildSetting(guildId, 'notification_speaker_id', newSpeakerId);
                const { guildCache } = services;
                const cached = guildCache.get(guildId);
                if (cached) {
                    cached.settings = null;
                    cached.compiled = false;
                }

                let speakerName = Object.entries(client.speakers).flatMap(([cn, ss]) => ss.map(s => ({ ...s, charName: cn }))).find(s => s.id === newSpeakerId);
                speakerName = speakerName ? `${speakerName.charName} (${speakerName.styleName})` : '不明';
                await interaction.update({ content: '設定を更新しました', components: [] });
                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setDescription(`入退室通知の話者を **${speakerName}** に設定しました。`);
                await channel.send({ embeds: [embed] });
            }
        }
        else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'ttsConfigModal_voicevox' ||
                interaction.customId === 'ttsConfigModal_aivoice' ||
                interaction.customId === 'ttsConfigModal' ||
                interaction.customId === 'voicevoxConfigModal') {
                const { user, fields, guildId, channel } = interaction;
                const { db } = services;

                const isAiVoice = interaction.customId === 'ttsConfigModal_aivoice';

                const updates = {};
                const validationErrors = [];

                const parseAndValidate = (id, parser, min, max, name) => {
                    const valueStr = fields.getTextInputValue(id)?.trim();
                    if (!valueStr) return null;
                    const value = parser(valueStr);
                    if (isNaN(value)) {
                        validationErrors.push(`${name}には有効な数値を入力してください。`);
                        return 'invalid';
                    }
                    if (value < min || value > max) {
                        validationErrors.push(`${name}は ${min} 〜 ${max} の範囲で入力してください。`);
                        return 'invalid';
                    }
                    return value;
                };

                const speedMin = isAiVoice ? 0.0 : 0.5;
                const speedMax = isAiVoice ? 4.0 : 2.0;
                const pitchMin = isAiVoice ? 0.0 : -0.15;
                const pitchMax = isAiVoice ? 2.0 : 0.15;
                const volumeMax = isAiVoice ? 5.0 : 10.0;

                updates.volume_scale = parseAndValidate('volumeScaleInput', parseFloat, 0.0, volumeMax, '音量');
                updates.speed_scale = parseAndValidate('speedScaleInput', parseFloat, speedMin, speedMax, '話速');
                updates.pitch_scale = parseAndValidate('pitchScaleInput', parseFloat, pitchMin, pitchMax, '声の高さ');
                updates.intonation_scale = parseAndValidate('intonationScaleInput', parseFloat, 0.0, 2.0, '抑揚');

                if (validationErrors.length > 0) {
                    return interaction.reply({
                        content: `入力エラー (´・ω・｀):\n- ${validationErrors.join('\n- ')}`, ephemeral: true
                    });
                }

                try {
                    const changedFields = [];
                    for (const key in updates) {
                        if (updates[key] !== null && updates[key] !== 'invalid') {
                            await db.updateUserSettings(user.id, guildId, key, updates[key]);
                            const name = key.replace('_scale', '');
                            changedFields.push({ name: name, value: `\`${updates[key]}\``, inline: true });
                        }
                    }

                    if (changedFields.length > 0) {
                        const userCache = userSettingsCache.get(guildId);
                        if (userCache) {
                            userCache.delete(user.id);
                        }
                        const embed = new EmbedBuilder().setColor(0x5865F2).setAuthor({ name: `${user.username} が音声パラメータを変更しました`, iconURL: user.displayAvatarURL() }).addFields(changedFields);
                        await channel.send({ embeds: [embed] });
                        await interaction.reply({ content: '設定を更新しました', ephemeral: true });
                    }
                    else {
                        await interaction.reply({ content: 'パラメータは変更されませんでした', ephemeral: true });
                    }
                }
                catch (error) {
                    logger.error(messages.errors.modal_save_failed, error);
                    await interaction.reply({ content: '設定の保存中にエラーが発生しました (´・ω・｀)', ephemeral: true });
                }
            }
            else if (interaction.customId === 'aivoicePauseModal') {
                const { user, fields, guildId, channel } = interaction;
                const { db } = services;
                const updates = {};
                const validationErrors = [];

                const parseAndValidateInt = (id, min, max, name) => {
                    const valueStr = fields.getTextInputValue(id)?.trim();
                    if (!valueStr) return null;
                    const value = parseInt(valueStr, 10);
                    if (isNaN(value)) {
                        validationErrors.push(`${name}には整数を入力してください。`);
                        return 'invalid';
                    }
                    if (value < min || value > max) {
                        validationErrors.push(`${name}は ${min} 〜 ${max} の範囲で入力してください。`);
                        return 'invalid';
                    }
                    return value;
                };

                updates.middle_pause = parseAndValidateInt('middlePauseInput', 80, 500, '短ポーズ');
                updates.long_pause = parseAndValidateInt('longPauseInput', 80, 2000, '長ポーズ');
                updates.sentence_pause = parseAndValidateInt('sentencePauseInput', 0, 10000, '文末ポーズ');

                if (validationErrors.length > 0) {
                    return interaction.reply({
                        content: `入力エラー (´・ω・｀):\n- ${validationErrors.join('\n- ')}`, ephemeral: true
                    });
                }

                try {
                    const changedFields = [];
                    const labelMap = { middle_pause: '短ポーズ', long_pause: '長ポーズ', sentence_pause: '文末ポーズ' };
                    for (const key in updates) {
                        if (updates[key] !== null && updates[key] !== 'invalid') {
                            await db.updateUserSettings(user.id, guildId, key, updates[key]);
                            changedFields.push({ name: labelMap[key], value: `\`${updates[key]} ms\``, inline: true });
                        }
                    }

                    if (changedFields.length > 0) {
                        const userCache = userSettingsCache.get(guildId);
                        if (userCache) {
                            userCache.delete(user.id);
                        }
                        const embed = new EmbedBuilder().setColor(0x5865F2).setAuthor({ name: `${user.username} がポーズ設定を変更しました`, iconURL: user.displayAvatarURL() }).addFields(changedFields);
                        await channel.send({ embeds: [embed] });
                        await interaction.reply({ content: '設定を更新しました', ephemeral: true });
                    }
                    else {
                        await interaction.reply({ content: 'パラメータは変更されませんでした', ephemeral: true });
                    }
                }
                catch (error) {
                    logger.error(messages.errors.modal_save_failed, error);
                    await interaction.reply({ content: '設定の保存中にエラーが発生しました (´・ω・｀)', ephemeral: true });
                }
            }
        }
    }
};
