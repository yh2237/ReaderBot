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

const commands = [];
const commandsPath = path.join(__dirname, '../commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const command = require(path.join(commandsPath, file));
	commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
	try {
		console.log(messages.scripts.deploy_start(commands.length));

		const data = await rest.put(
			Routes.applicationCommands(clientId),
			{ body: commands },
		);

		console.log(messages.scripts.deploy_success(data.length));
	} catch (error) {
		console.error(error);
	}
})();
