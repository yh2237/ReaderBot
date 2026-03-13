'use strict';

const { createAudioResource } = require('@discordjs/voice');
const { BOT_NOTIFICATION_ID } = require('../utils/constants.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const logger = require('../utils/logger.js');

const CACHE_DIR = 'cache/audio';
const PS1_PATH = path.join(__dirname, '..', 'scripts', 'aivoice_synth.ps1');

const KEEPALIVE_INTERVAL_MS = 9 * 60 * 1000;

function getAudioCacheKey(voicePresetName, params, text) {
    const data = `aivoice:${voicePresetName}:${params.speed}:${params.pitch}:${params.pitchRange}:${params.volume}:${params.middlePause}:${params.longPause}:${params.sentencePause}:${text}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

function sendRequest(aivoiceState, msg) {
    return new Promise((resolve, reject) => {
        if (!aivoiceState.proc || !aivoiceState.ready) {
            return reject(new Error('A.I.VOICE: PowerShell プロセスが起動していません。'));
        }

        const id = ++aivoiceState.requestId;
        aivoiceState.pendingResolvers.set(id, { resolve, reject });
        const line = JSON.stringify(msg) + '\n';
        aivoiceState.proc.stdin.write(line, 'utf8');
    });
}

function handlePsResponse(aivoiceState, line) {
    let res;
    try {
        res = JSON.parse(line);
    } catch {
        logger.warn(`A.I.VOICE: PowerShell から不正な JSON を受信: ${line}`);
        return;
    }

    const firstEntry = aivoiceState.pendingResolvers.entries().next();
    if (firstEntry.done) {
        logger.warn(`A.I.VOICE: 未対応のレスポンスを受信: ${line}`);
        return;
    }

    const [id, { resolve, reject }] = firstEntry.value;
    aivoiceState.pendingResolvers.delete(id);

    if (res.ok) {
        resolve(res.data ?? null);
    } else {
        reject(new Error(res.error || 'A.I.VOICE: 不明なエラー'));
    }
}

async function connectAiVoice(aivoiceState, hostName, dllPath) {
    if (aivoiceState.proc) {
        try {
            aivoiceState.proc.stdin.write(JSON.stringify({ type: 'quit' }) + '\n');
        } catch { /* うへ */ }
        aivoiceState.proc = null;
        aivoiceState.ready = false;
    }

    if (aivoiceState.keepAliveTimer) {
        clearInterval(aivoiceState.keepAliveTimer);
        aivoiceState.keepAliveTimer = null;
    }

    return new Promise((resolve, reject) => {
        const proc = spawn('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', PS1_PATH,
        ], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });

        aivoiceState.proc = proc;
        aivoiceState.ready = false;
        aivoiceState.requestId = 0;
        aivoiceState.pendingResolvers = new Map();
        aivoiceState.dllPath = dllPath;

        let stdoutBuf = '';
        let initDone = false;

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => {
            stdoutBuf += chunk;
            const lines = stdoutBuf.split('\n');
            stdoutBuf = lines.pop();

            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;

                if (!initDone) {
                    initDone = true;
                    let res;
                    try {
                        res = JSON.parse(line);
                    } catch {
                        aivoiceState.ready = false;
                        return reject(new Error(`A.I.VOICE: PowerShell から不正な初期化レスポンス: ${line}`));
                    }

                    if (res.ok) {
                        aivoiceState.ready = true;
                        aivoiceState.hostName = res.data?.hostName || hostName;
                        aivoiceState.presetNames = res.data?.presetNames || [];

                        proc.stdout.removeAllListeners('data');
                        let buf2 = '';
                        proc.stdout.on('data', (c) => {
                            buf2 += c;
                            const ls = buf2.split('\n');
                            buf2 = ls.pop();
                            for (const l of ls) {
                                const t = l.trim();
                                if (t) handlePsResponse(aivoiceState, t);
                            }
                        });

                        aivoiceState.keepAliveTimer = setInterval(async () => {
                            try {
                                await sendRequest(aivoiceState, { type: 'keepalive' });
                                logger.debug('A.I.VOICE: keepalive OK');
                            } catch (e) {
                                logger.warn(`A.I.VOICE: keepalive 失敗: ${e.message}`);
                            }
                        }, KEEPALIVE_INTERVAL_MS);

                        resolve(aivoiceState.presetNames);
                    } else {
                        aivoiceState.ready = false;
                        reject(new Error(`A.I.VOICE: 初期化失敗: ${res.error}`));
                    }
                } else {
                    handlePsResponse(aivoiceState, line);
                }
            }
        });

        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (data) => {
            logger.warn(`A.I.VOICE PowerShell stderr: ${data.trimEnd()}`);
        });

        proc.on('close', (code) => {
            logger.warn(`A.I.VOICE: PowerShell プロセスが終了しました (code=${code})`);
            aivoiceState.ready = false;
            aivoiceState.proc = null;

            for (const { reject: rej } of aivoiceState.pendingResolvers.values()) {
                rej(new Error('A.I.VOICE: PowerShell プロセスが予期せず終了しました。'));
            }
            aivoiceState.pendingResolvers.clear();

            if (!initDone) {
                reject(new Error('A.I.VOICE: PowerShell プロセスが初期化前に終了しました。'));
            }
        });

        proc.on('error', (err) => {
            logger.error(`A.I.VOICE: PowerShell プロセス起動エラー: ${err.message}`);
            if (!initDone) {
                reject(err);
            }
        });

        const initMsg = JSON.stringify({ type: 'init', dllPath, hostName: hostName || '' }) + '\n';
        proc.stdin.write(initMsg, 'utf8');
    });
}

function buildSpeakersFromPresets(presetNames, prefix) {
    const speakers = {};
    for (const name of presetNames) {
        const key = prefix ? `${prefix}: ${name}` : name;
        const id = prefix ? `${prefix}:${name}` : name;
        speakers[key] = [{ styleName: name, id }];
    }
    return speakers;
}

async function synthesizeToFile(aivoiceState, text, voicePresetName, params, outputPath) {
    await sendRequest(aivoiceState, {
        type: 'synth',
        text,
        preset: voicePresetName,
        speed: params.speed ?? 1.0,
        pitch: params.pitch ?? 1.0,
        pitchRange: params.pitchRange ?? 1.0,
        volume: params.volume ?? 1.0,
        middlePause: params.middlePause ?? 150,
        longPause: params.longPause ?? 370,
        sentencePause: params.sentencePause ?? 800,
        outputPath,
    });
}

async function processMessageToAudio(item, guildId, services, isPrefetch = false) {
    const { config, aivoiceState, db, userSettingsCache } = services;
    const timing = {
        start: process.hrtime.bigint(),
        cacheHit: null,
        settingsMs: null,
        synthesisMs: null,
        totalMs: null
    };

    let userSettings;
    try {
        if (item.authorId === BOT_NOTIFICATION_ID) {
            const guildSettings = services.guildCache.get(guildId)?.settings
                || await db.getGuildSettings(guildId);
            const dp = config.aivoice?.default_params || {};
            const notifySpeakerId = guildSettings?.notification_speaker_id
                || config.aivoice?.notification_voice_preset
                || null;
            userSettings = {
                speaker_id: notifySpeakerId,
                speed_scale: dp.speed_scale ?? 1.0,
                pitch_scale: dp.pitch_scale ?? 1.0,
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
                userSettings = guildCache.get(item.authorId);
                if (!userSettings) {
                    userSettings = await db.getUserSettings(item.authorId, guildId);
                    if (userSettings) {
                        guildCache.set(item.authorId, userSettings);
                    }
                }
            }
        }

        const rawSpeakerId = userSettings?.speaker_id ?? null;
        const defaultPreset = config.aivoice?.default_voice_preset
            || (aivoiceState.presetNames && aivoiceState.presetNames[0])
            || null;

        if (!userSettings || userSettings.speaker_id === null || userSettings.speaker_id === undefined) {
            const dp = config.aivoice?.default_params || {};
            const defaultSettings = {
                speaker_id: defaultPreset,
                speed_scale: dp.speed_scale ?? 1.0,
                pitch_scale: dp.pitch_scale ?? 1.0,
                intonation_scale: dp.intonation_scale ?? 1.0,
                volume_scale: dp.volume_scale ?? 1.0
            };
            if (item.authorId !== BOT_NOTIFICATION_ID) {
                db.updateUserSettings(item.authorId, guildId, 'speaker_id', defaultSettings.speaker_id).catch(logger.error);
                const guildCache = userSettingsCache.get(guildId);
                if (guildCache) guildCache.set(item.authorId, defaultSettings);
            }
            userSettings = defaultSettings;
        }

        const speakerIdRaw = userSettings.speaker_id || defaultPreset;
        const voicePresetName = (typeof speakerIdRaw === 'string' && speakerIdRaw.startsWith('A.I.VOICE:'))
            ? speakerIdRaw.slice('A.I.VOICE:'.length)
            : speakerIdRaw;
        if (!voicePresetName) {
            throw new Error('A.I.VOICE: ボイスプリセットが設定されていません。');
        }

        const dp = config.aivoice?.default_params || {};
        const currentParams = {
            speed: userSettings.speed_scale ?? dp.speed_scale ?? 1.0,
            pitch: userSettings.pitch_scale ?? dp.pitch_scale ?? 1.0,
            pitchRange: userSettings.intonation_scale ?? dp.intonation_scale ?? 1.0,
            volume: userSettings.volume_scale ?? dp.volume_scale ?? 1.0,
            middlePause: userSettings.middle_pause ?? 150,
            longPause: userSettings.long_pause ?? 370,
            sentencePause: userSettings.sentence_pause ?? 800,
        };

        const settingsDone = process.hrtime.bigint();
        timing.settingsMs = Number(settingsDone - timing.start) / 1e6;

        const audioHash = getAudioCacheKey(voicePresetName, currentParams, item.content);
        const cachePath = path.join(CACHE_DIR, `${audioHash}.wav`);

        try {
            await fs.promises.access(cachePath, fs.constants.F_OK);
            timing.cacheHit = true;
            timing.totalMs = Number(process.hrtime.bigint() - timing.start) / 1e6;
            logger.debug(`aivoice timing (cache hit): settings=${timing.settingsMs}ms total=${timing.totalMs}ms`);
            logger.info('Persistent Audio Cache Hit!');
            return createAudioResource(fs.createReadStream(cachePath));
        } catch {
        }
        timing.cacheHit = false;

        if (!aivoiceState || !aivoiceState.ready) {
            throw new Error('A.I.VOICE: PowerShell プロセスが起動していません。');
        }

        const tmpPath = path.join(os.tmpdir(), `aivoice_${audioHash}.wav`);

        const synthesisStart = process.hrtime.bigint();
        await synthesizeToFile(aivoiceState, item.content, voicePresetName, currentParams, tmpPath);
        timing.synthesisMs = Number(process.hrtime.bigint() - synthesisStart) / 1e6;

        try {
            await fs.promises.rename(tmpPath, cachePath);
        } catch {
            try {
                await fs.promises.copyFile(tmpPath, cachePath);
            } catch (copyErr) {
                logger.error('A.I.VOICE: キャッシュへの保存に失敗しました:', copyErr);
            } finally {
                await fs.promises.unlink(tmpPath).catch(() => { });
            }
        }

        timing.totalMs = Number(process.hrtime.bigint() - timing.start) / 1e6;
        logger.debug(`aivoice timing: settings=${timing.settingsMs}ms synthesis=${timing.synthesisMs}ms total=${timing.totalMs}ms`);

        return createAudioResource(fs.createReadStream(cachePath));

    } catch (error) {
        timing.totalMs = Number(process.hrtime.bigint() - timing.start) / 1e6;
        logger.debug(`aivoice timing (error): settings=${timing.settingsMs}ms total=${timing.totalMs}ms`);
        logger.error('Fatal error in aivoice processMessageToAudio:', error);
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

module.exports = {
    connectAiVoice,
    buildSpeakersFromPresets,
    playNextMessage,
    prefetchMessages,
    _processMessageToAudio: processMessageToAudio,
};
