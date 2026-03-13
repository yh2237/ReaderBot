
const { scheduleBackup } = require('../utils/backup.js');
const { pruneCache } = require('../utils/cacheManager.js');
const { connectAiVoice, buildSpeakersFromPresets } = require('../features/aivoice.js');
const logger = require('../utils/logger.js');
const messages = require('../utils/messages.js');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client, services) {
        const { config, voicevoxEngines, aivoiceState, useVoicevox, useAiVoice } = services;

        logger.success(messages.system.login_success(client.user.tag));

        const initTasks = [];

        if (useAiVoice) {
            initTasks.push((async () => {
                logger.info(messages.aivoice.connect_start);
                try {
                    const hostName = config.aivoice?.host_name || '';
                    const dllPath = config.aivoice?.dll_path || 'C:\\Program Files\\AI\\AIVoice\\AIVoiceEditor\\AI.Talk.Editor.Api.dll';
                    const presetNames = await connectAiVoice(aivoiceState, hostName, dllPath);

                    aivoiceState.presetNames = presetNames || [];

                    const aiSpeakers = buildSpeakersFromPresets(aivoiceState.presetNames, 'A.I.VOICE');
                    Object.assign(client.speakers, aiSpeakers);

                    logger.success(messages.aivoice.connect_success(aivoiceState.hostName, aivoiceState.presetNames.length));
                } catch (error) {
                    logger.error(messages.aivoice.connect_failed, error.message);
                }
            })());
        }

        if (useVoicevox) {
            initTasks.push((async () => {
                logger.info(messages.voicevox.health_check_start);
                const healthChecks = voicevoxEngines.map(engine =>
                    engine.client.get('/version')
                        .then(() => ({ url: engine.url, status: 'healthy' }))
                        .catch(() => ({ url: engine.url, status: 'unhealthy' }))
                );

                const results = await Promise.allSettled(healthChecks);
                results.forEach((result, i) => {
                    if (result.status === 'fulfilled') {
                        voicevoxEngines[i].status = result.value.status;
                        logger.info(messages.voicevox.engine_status(voicevoxEngines[i].url, voicevoxEngines[i].status));
                    } else {
                        voicevoxEngines[i].status = 'unhealthy';
                        logger.warn(messages.voicevox.engine_unhealthy(voicevoxEngines[i].url));
                    }
                });

                const healthyEngines = voicevoxEngines.filter(e => e.status === 'healthy');
                if (healthyEngines.length === 0) {
                    logger.error(messages.voicevox.no_healthy_engines);
                } else {
                    try {
                        let primaryEngine = null;
                        const speakerSourceUrl = config.voicevox?.speaker_source_url;
                        if (speakerSourceUrl) {
                            const designatedEngine = healthyEngines.find(e => e.url === speakerSourceUrl);
                            if (designatedEngine) {
                                primaryEngine = designatedEngine;
                                logger.info(messages.voicevox.using_designated_engine(primaryEngine.url));
                            } else {
                                logger.warn(messages.voicevox.designated_engine_unhealthy(speakerSourceUrl));
                                primaryEngine = healthyEngines[0];
                            }
                        } else {
                            primaryEngine = healthyEngines[0];
                        }

                        const response = await primaryEngine.client.get('/speakers');
                        const vvSpeakers = response.data.reduce((acc, speaker) => {
                            acc[`VOICEVOX: ${speaker.name}`] = speaker.styles.map(style => ({
                                styleName: style.name,
                                id: `VOICEVOX:${style.id}`
                            }));
                            return acc;
                        }, {});
                        Object.assign(client.speakers, vvSpeakers);
                        logger.success(messages.voicevox.speakers_fetched(Object.keys(vvSpeakers).length, primaryEngine.url));
                    } catch (error) {
                        logger.error(messages.voicevox.fetch_speakers_failed, error.message);
                    }
                }

                setInterval(async () => {
                    const unhealthyEngines = voicevoxEngines.filter(e => e.status === 'unhealthy');
                    for (const engine of unhealthyEngines) {
                        try {
                            await engine.client.get('/version');
                            engine.status = 'healthy';
                            logger.success(messages.voicevox.engine_recovered(engine.url));
                        } catch { }
                    }
                }, 30 * 1000);
            })());
        }

        await Promise.allSettled(initTasks);

        logger.success(messages.system.ready);

        scheduleBackup(config);

        pruneCache('cache/audio', config.audio_cache_limit);
        setInterval(() => {
            pruneCache('cache/audio', config.audio_cache_limit);
        }, 60 * 60 * 1000);
    },
};
