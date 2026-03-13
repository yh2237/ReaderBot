const { createAudioResource } = require('@discordjs/voice');
const { PassThrough } = require('stream');
const { BOT_NOTIFICATION_ID } = require('../utils/constants.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger.js');

const CACHE_DIR = 'cache/audio';

function getAudioCacheKey(speakerId, params, text) {
    const data = `${speakerId}:${params.speed_scale}:${params.pitch_scale}:${params.intonation_scale}:${params.volume_scale}:${text}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

function getQueryCacheKey(speakerId, text) {
    return `${speakerId}:${text}`;
}

function cloneAudioQuery(data) {
    if (typeof structuredClone === 'function') {
        return structuredClone(data);
    }
    return JSON.parse(JSON.stringify(data));
}

async function processMessageToAudio(item, guildId, services, isPrefetch = false) {
    const { config, voicevoxEngines, db, userSettingsCache, queryCache } = services;
    const timing = {
        start: process.hrtime.bigint(),
        cacheHit: null,
        settingsMs: null,
        queryMs: null,
        synthesisMs: null,
        totalMs: null
    };

    let userSettings;
    try {
        if (item.authorId === BOT_NOTIFICATION_ID) {
            const guildSettings = services.guildCache.get(guildId)?.settings
                || await db.getGuildSettings(guildId);
            const dp = config.voicevox?.default_params || {};
            const notifySpeakerId = guildSettings?.notification_speaker_id
                || config.voicevox?.notification_speaker_id
                || config.voicevox?.default_speaker_id
                || 1;
            userSettings = {
                speaker_id: notifySpeakerId,
                speed_scale: dp.speed_scale ?? 1.0,
                pitch_scale: dp.pitch_scale ?? 0.0,
                intonation_scale: dp.intonation_scale ?? 1.0,
                volume_scale: dp.volume_scale ?? 1.0
            };
        } else {
            if (item.settingsPromise) {
                userSettings = await item.settingsPromise;
                let guildCache = userSettingsCache.get(guildId);
                if (!guildCache) {
                    guildCache = new Map();
                    userSettingsCache.set(guildId, guildCache);
                }
                guildCache.set(item.authorId, userSettings);
            } else {
                let guildCache = userSettingsCache.get(guildId);
                if (!guildCache) {
                    guildCache = new Map();
                    userSettingsCache.set(guildId, guildCache);
                }

                if (guildCache.has(item.authorId)) {
                    userSettings = guildCache.get(item.authorId);
                } else {
                    userSettings = await db.getUserSettings(item.authorId, guildId);
                    guildCache.set(item.authorId, userSettings ?? null);
                }
            }
        }

        if (!userSettings || userSettings.speaker_id === null) {
            const rawDefault = config.voicevox?.default_speaker_id || config.speaker_id || 1;
            const defaultSpeakerId = (typeof rawDefault === 'string' && rawDefault.startsWith('VOICEVOX:'))
                ? rawDefault
                : `VOICEVOX:${rawDefault}`;
            const cfgP = config.voicevox?.default_params;
            const defaultSettings = {
                speaker_id: defaultSpeakerId,
                speed_scale: cfgP?.speed_scale ?? 1.0,
                pitch_scale: cfgP?.pitch_scale ?? 0.0,
                intonation_scale: cfgP?.intonation_scale ?? 1.0,
                volume_scale: cfgP?.volume_scale ?? 1.0,
            };
            if (item.authorId !== BOT_NOTIFICATION_ID) {
                db.updateUserSettings(item.authorId, guildId, 'speaker_id', defaultSettings.speaker_id).catch(logger.error);
                const guildCache = userSettingsCache.get(guildId);
                if (guildCache) guildCache.set(item.authorId, defaultSettings);
            }
            userSettings = defaultSettings;
        }

        const rawDefaultSpeaker = config.voicevox?.default_speaker_id || config.speaker_id || 1;
        const cfgDefaults = config.voicevox?.default_params;
        const defaults = {
            speaker_id: (typeof rawDefaultSpeaker === 'string' && rawDefaultSpeaker.startsWith('VOICEVOX:'))
                ? rawDefaultSpeaker
                : `VOICEVOX:${rawDefaultSpeaker}`,
            speed_scale: cfgDefaults?.speed_scale ?? 1.0,
            pitch_scale: cfgDefaults?.pitch_scale ?? 0.0,
            intonation_scale: cfgDefaults?.intonation_scale ?? 1.0,
            volume_scale: cfgDefaults?.volume_scale ?? 1.0,
        };
        const rawId = userSettings?.speaker_id ?? defaults.speaker_id;
        const speakerId = (typeof rawId === 'string' && rawId.startsWith('VOICEVOX:'))
            ? parseInt(rawId.slice('VOICEVOX:'.length), 10)
            : Number(rawId);
        const currentParams = {
            speed_scale: userSettings?.speed_scale ?? defaults.speed_scale,
            pitch_scale: userSettings?.pitch_scale ?? defaults.pitch_scale,
            intonation_scale: userSettings?.intonation_scale ?? defaults.intonation_scale,
            volume_scale: userSettings?.volume_scale ?? defaults.volume_scale
        };

        const settingsDone = process.hrtime.bigint();
        timing.settingsMs = Number(settingsDone - timing.start) / 1e6;

        const audioHash = getAudioCacheKey(speakerId, currentParams, item.content);
        const cachePath = path.join(CACHE_DIR, `${audioHash}.wav`);

        try {
            await fs.promises.access(cachePath, fs.constants.F_OK);
            timing.cacheHit = true;
            timing.totalMs = Number(process.hrtime.bigint() - timing.start) / 1e6;
            logger.debug(`tts timing (cache hit): settings=${timing.settingsMs}ms total=${timing.totalMs}ms`);
            logger.info('Persistent Audio Cache Hit!');
            return createAudioResource(fs.createReadStream(cachePath));
        } catch {
        }
        timing.cacheHit = false;

        const healthyEngines = voicevoxEngines.filter(e => e.status === 'healthy');
        if (healthyEngines.length === 0) {
            throw new Error('No healthy VOICEVOX engines available.');
        }

        const engine = healthyEngines.sort((a, b) => a.requests - b.requests)[0];
        engine.requests++;
        logger.debug(`Processing audio with engine ${engine.url}, current requests: ${engine.requests}`);

        try {
            let audioQueryData;
            const queryKey = getQueryCacheKey(speakerId, item.content);

            const queryStart = process.hrtime.bigint();
            if (queryCache.has(queryKey)) {
                logger.debug('Query Cache Hit!');
                audioQueryData = cloneAudioQuery(queryCache.get(queryKey));
            } else {
                const audioQuery = await engine.client.post('/audio_query', null, {
                    params: { speaker: speakerId, text: item.content }
                });
                audioQueryData = audioQuery.data;
                if (queryCache.size >= 5000) {
                    const firstKey = queryCache.keys().next().value;
                    queryCache.delete(firstKey);
                }
                queryCache.set(queryKey, cloneAudioQuery(audioQueryData));
            }
            timing.queryMs = Number(process.hrtime.bigint() - queryStart) / 1e6;

            audioQueryData.speedScale = currentParams.speed_scale;
            audioQueryData.pitchScale = currentParams.pitch_scale;
            audioQueryData.intonationScale = currentParams.intonation_scale;
            audioQueryData.volumeScale = currentParams.volume_scale;
            audioQueryData.outputSamplingRate = 24000;

            const synthesisStart = process.hrtime.bigint();
            const synthesisResponse = await engine.client.post(`/synthesis?speaker=${speakerId}`, audioQueryData, { responseType: 'stream' });
            timing.synthesisMs = Number(process.hrtime.bigint() - synthesisStart) / 1e6;

            const discordStream = new PassThrough();
            const tmpCachePath = cachePath + '.tmp';
            const writeStream = fs.createWriteStream(tmpCachePath);
            let writeError = false;

            synthesisResponse.data.on('data', (chunk) => {
                discordStream.push(chunk);
                if (!writeError) writeStream.write(chunk);
            });
            synthesisResponse.data.on('end', () => {
                discordStream.push(null);
                writeStream.end(() => {
                    if (!writeError) {
                        fs.rename(tmpCachePath, cachePath, (err) => {
                            if (err) {
                                logger.error('Failed to rename cache file:', err);
                                fs.unlink(tmpCachePath, () => { });
                            }
                        });
                    }
                });
            });
            synthesisResponse.data.on('error', (err) => {
                logger.error('Synthesis stream error:', err);
                discordStream.destroy(err);
                writeError = true;
                writeStream.destroy();
                fs.unlink(tmpCachePath, () => { });
            });
            writeStream.on('error', (err) => {
                logger.error('Failed to write cache file:', err);
                writeError = true;
                fs.unlink(tmpCachePath, () => { });
            });

            timing.totalMs = Number(process.hrtime.bigint() - timing.start) / 1e6;
            logger.debug(`tts timing: settings=${timing.settingsMs}ms query=${timing.queryMs}ms synthesis=${timing.synthesisMs}ms total=${timing.totalMs}ms`);
            return createAudioResource(discordStream);

        } catch (error) {
            logger.error(`Error in processMessageToAudio with engine ${engine.url}:`, error.message);
            engine.status = 'unhealthy';
            throw error;
        } finally {
            engine.requests--;
        }

    } catch (error) {
        timing.totalMs = Number(process.hrtime.bigint() - timing.start) / 1e6;
        logger.debug(`tts timing (error): settings=${timing.settingsMs}ms query=${timing.queryMs}ms synthesis=${timing.synthesisMs}ms total=${timing.totalMs}ms`);
        logger.error('Fatal error in processMessageToAudio:', error);
        throw error;
    }
}

function prefetchMessages(guildId, services) {
    const { messageQueues, config } = services;
    const guildQueue = messageQueues.get(guildId);

    if (!guildQueue || guildQueue.queue.length === 0) return;

    const depth = Math.max(1, Number(config.prefetch_depth || 1));
    const limit = Math.min(depth, guildQueue.queue.length);

    for (let i = 0; i < limit; i++) {
        const item = guildQueue.queue[i];
        if (!item.audioPromise) {
            logger.debug(`Prefetching message ${i + 1}/${depth}...`);
            item.audioPromise = processMessageToAudio(item, guildId, services, true);
            item.audioPromise.catch((err) => logger.debug(`Prefetch failed: ${err.message}`));
        }
    }
}

async function playNextMessage(guildId, services) {
    const { messageQueues, players, db } = services;
    const guildQueue = messageQueues.get(guildId);
    const player = players.get(guildId);

    if (!guildQueue || guildQueue.queue.length === 0 || !player || player.state.status !== 'idle') {
        return;
    }

    const item = guildQueue.queue[0];

    if (!item.audioPromise) {
        item.audioPromise = processMessageToAudio(item, guildId, services);
    }

    try {
        const resource = await item.audioPromise;

        guildQueue.queue.shift();
        player.play(resource);

        db.incrementStat('totalMessagesRead').catch(logger.error);

        if (guildQueue.queue.length > 0) {
            prefetchMessages(guildId, services);
        }

    } catch (error) {
        logger.error('Failed to play message:', error);
        guildQueue.queue.shift();
        playNextMessage(guildId, services);
    }
}

async function warmup(services) {
    const { voicevoxEngines } = services;
    const healthyEngines = voicevoxEngines.filter(e => e.status === 'healthy');
    if (healthyEngines.length === 0) return;

    const engine = healthyEngines.sort((a, b) => a.requests - b.requests)[0];

    logger.debug(`Warming up engine ${engine.url}...`);
    try {
        await engine.client.get('/version');
        logger.debug(`Engine ${engine.url} warmed up.`);
    } catch (error) {
        logger.debug(`Warmup failed for ${engine.url}: ${error.message}`);
    }
}

module.exports = { playNextMessage, prefetchMessages, warmup, _processMessageToAudio: processMessageToAudio };
