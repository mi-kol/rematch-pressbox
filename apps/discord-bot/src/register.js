import "dotenv/config";
import { REST, Routes } from 'discord.js';

export async function registerCommands() {
    const token = process.env.DISCORD_TOKEN;
    const appId = process.env.DISCORD_APP_ID;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!token || !appId || !guildId) throw new Error("something discord related is missing");

    const rest = new REST({ version: "10" }).setToken(token);

    const body = [
        {
            name: 'pressconf',
            description: 'call a press conference',
            options: [
                {
                    name: 'latest',
                    description: 'call a press conference related to the most recent detected game session',
                    type: 1
                },
                {
                    name: 'republish',
                    description: 're-generate and publish from the latest saved press conference',
                    type: 1
                }
            ]

        }
    ];

    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    console.log(`slash commands registered`);
}

// registerCommands();