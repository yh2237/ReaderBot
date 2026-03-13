const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
require('dotenv').config();
const messages = require('../utils/messages.js');

const configPath = path.join(__dirname, '../config/config.yml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

const clientId = process.env.DISCORD_CLIENT_ID || config.client_id;
const token = process.env.DISCORD_TOKEN || config.discord_token;

if (!clientId || !token) {
    console.error(messages.errors.config_missing);
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

const guildId = process.argv[2] || null;

if (guildId) {
    rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] })
        .then(() => console.log(messages.scripts.delete_guild_success(guildId)))
        .catch(console.error);
} else {
    rest.put(Routes.applicationCommands(clientId), { body: [] })
        .then(() => console.log(messages.scripts.delete_global_success))
        .catch(console.error);
    console.log(messages.scripts.guild_id_not_specified);
}
