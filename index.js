const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
require('dotenv').config();
const yaml = require('js-yaml');
const fs = require('node:fs');
const path = require('node:path');
const http = require('http');
const https = require('https');
const axios = require('axios');
const db = require('./utils/database.js');
const { BOT_NOTIFICATION_ID } = require('./utils/constants.js');
const { warmup: voicevoxWarmup, _processMessageToAudio: voicevoxProcessSingle } = require('./features/tts.js');
const { _processMessageToAudio: aivoiceProcessSingle } = require('./features/aivoice.js');

const config = yaml.load(fs.readFileSync('config/config.yml', 'utf8'));
config.discord_token = process.env.DISCORD_TOKEN || config.discord_token;
config.client_id = process.env.DISCORD_CLIENT_ID || config.client_id;
db.initialize(config.database_file);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
});

const useVoicevox = config.voicevox?.enabled === true;
const useAiVoice = config.aivoice?.enabled === true;

if (!useVoicevox && !useAiVoice) {
    console.error('設定エラー: voicevox.enabled と aivoice.enabled の両方が false です。少なくとも1つを有効にしてください。');
    process.exit(1);
}

const agentOptions = { keepAlive: true };
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

const voicevoxEngines = useVoicevox
    ? (config.voicevox.engine_urls || []).map(url => ({
        url,
        requests: 0,
        status: 'unknown',
        client: axios.create({ baseURL: url, httpAgent, httpsAgent, timeout: 10000 })
    }))
    : [];

const aivoiceState = useAiVoice ? {
    proc: null,
    hostName: null,
    presetNames: [],
    ready: false,
    pendingResolvers: new Map(),
    requestId: 0,
    keepAliveTimer: null,
    dllPath: '',
} : null;

function detectEngine(speakerId, voicevoxEnabled, aiVoiceEnabled, defaultEngine) {
    if (typeof speakerId === 'string') {
        if (speakerId.startsWith('A.I.VOICE:') && aiVoiceEnabled) return 'aivoice';
        if (speakerId.startsWith('VOICEVOX:') && voicevoxEnabled) return 'voicevox';
    }
    const preferred = defaultEngine === 'aivoice' ? 'aivoice' : 'voicevox';
    if (preferred === 'aivoice' && aiVoiceEnabled) return 'aivoice';
    if (preferred === 'voicevox' && voicevoxEnabled) return 'voicevox';
    if (aiVoiceEnabled) return 'aivoice';
    return 'voicevox';
}

async function routedPlayNext(guildId, services) {
    const { messageQueues, players, db } = services;
    const guildQueue = messageQueues.get(guildId);
    const player = players.get(guildId);

    if (!guildQueue || guildQueue.queue.length === 0 || !player || player.state.status !== 'idle') {
        return;
    }

    const item = guildQueue.queue[0];

    if (!item.audioPromise) {
        item.audioPromise = resolveAudioForItem(item, guildId, services);
    }

    try {
        const resource = await item.audioPromise;
        guildQueue.queue.shift();
        player.play(resource);
        db.incrementStat('totalMessagesRead').catch(() => { });
        if (guildQueue.queue.length > 0) {
            routedPrefetch(guildId, services);
        }
    } catch (error) {
        const logger = require('./utils/logger.js');
        logger.error('Failed to play message:', error);
        guildQueue.queue.shift();
        routedPlayNext(guildId, services);
    }
}

function routedPrefetch(guildId, services) {
    const { messageQueues, config } = services;
    const guildQueue = messageQueues.get(guildId);
    if (!guildQueue || guildQueue.queue.length === 0) return;

    const depth = Math.max(1, Number(config.prefetch_depth || 1));
    const limit = Math.min(depth, guildQueue.queue.length);
    const logger = require('./utils/logger.js');

    for (let i = 0; i < limit; i++) {
        const item = guildQueue.queue[i];
        if (!item.audioPromise) {
            logger.debug(`Prefetching message ${i + 1}/${depth}...`);
            item.audioPromise = resolveAudioForItem(item, guildId, services);
            item.audioPromise.catch((err) => logger.debug(`Prefetch failed: ${err.message}`));
        }
    }
}

async function resolveAudioForItem(item, guildId, services) {
    const { db, userSettingsCache, config } = services;
    const defaultEngine = config.default_engine || 'voicevox';

    if (item.authorId === BOT_NOTIFICATION_ID) {
        const guildSettings = services.guildCache.get(guildId)?.settings
            || await db.getGuildSettings(guildId);
        const notifySpeakerId = guildSettings?.notification_speaker_id || null;
        const engineForNotify = detectEngine(notifySpeakerId, useVoicevox, useAiVoice, defaultEngine);
        if (engineForNotify === 'aivoice') {
            return aivoiceProcessSingle(item, guildId, services);
        } else {
            return voicevoxProcessSingle(item, guildId, services);
        }
    }

    let speakerId = null;
    if (item.settingsPromise) {
        const settings = await item.settingsPromise;
        let guildCache = userSettingsCache.get(guildId);
        if (!guildCache) { guildCache = new Map(); userSettingsCache.set(guildId, guildCache); }
        guildCache.set(item.authorId, settings ?? null);
        speakerId = settings?.speaker_id ?? null;
        item.settingsPromise = null;
        item.resolvedSettings = speakerId;
    } else if (item.resolvedSettings !== undefined) {
        speakerId = item.resolvedSettings;
    } else {
        const guildCacheMap = userSettingsCache.get(guildId);
        if (guildCacheMap && guildCacheMap.has(item.authorId)) {
            const cached = guildCacheMap.get(item.authorId);
            speakerId = cached?.speaker_id ?? null;
        } else {
            const settings = await db.getUserSettings(item.authorId, guildId);
            speakerId = settings?.speaker_id ?? null;
            if (guildCacheMap) {
                guildCacheMap.set(item.authorId, settings ?? null);
            } else {
                const newMap = new Map();
                newMap.set(item.authorId, settings ?? null);
                userSettingsCache.set(guildId, newMap);
            }
        }
    }

    let effectiveSpeakerId = speakerId;
    if (!effectiveSpeakerId) {
        if (defaultEngine === 'aivoice' && useAiVoice) {
            effectiveSpeakerId = `A.I.VOICE:${config.aivoice?.default_voice_preset || ''}`;
        } else {
            effectiveSpeakerId = `VOICEVOX:${config.voicevox?.default_speaker_id || 1}`;
        }
    }
    const engineForItem = detectEngine(effectiveSpeakerId, useVoicevox, useAiVoice, defaultEngine);

    if (engineForItem === 'aivoice') {
        return aivoiceProcessSingle(item, guildId, services);
    } else {
        return voicevoxProcessSingle(item, guildId, services);
    }
}

async function routedWarmup(services) {
    if (useVoicevox) await voicevoxWarmup(services);
}

const services = {
    connections: new Map(),
    players: new Map(),
    messageQueues: new Map(),
    userSettingsCache: new Map(),
    guildCache: new Map(),
    queryCache: new Map(),
    db,
    config,
    client,
    playNextMessage: routedPlayNext,
    prefetchMessages: routedPrefetch,
    warmup: routedWarmup,
    voicevoxEngines,
    aivoiceState,
    useVoicevox,
    useAiVoice,
};
client.speakers = {};

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    }
}

const handlersPath = path.join(__dirname, 'handlers');
const handlerFiles = fs.readdirSync(handlersPath).filter(file => file.endsWith('.js'));

for (const file of handlerFiles) {
    const filePath = path.join(handlersPath, file);
    const handler = require(filePath);
    if (handler.once) {
        client.once(handler.name, (...args) => handler.execute(...args, services));
    } else {
        client.on(handler.name, (...args) => handler.execute(...args, services));
    }
}

client.login(config.discord_token);
