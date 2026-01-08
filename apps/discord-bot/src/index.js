import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { registerCommands } from "./register.js";
import { buildCtx } from "./ctx.js";

import * as pressconf from "./commands/pressconf/index.js";

const commands = new Map([[pressconf.name, pressconf]]);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once("clientReady", () => console.log(`bot ready: ${client.user.tag}`));

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = commands.get(interaction.commandName);
  if (!cmd) return interaction.reply({ content: "unknown command", ephemeral: true });

  try {
    const ctx = buildCtx();
    await cmd.execute(interaction, ctx);
  } catch (e) {
    console.error(e);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: "rip, something broke. check console logs.", ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: "rip, something broke. check console logs.", ephemeral: true }).catch(() => {});
    }
  }
});

await registerCommands();
client.login(process.env.DISCORD_TOKEN);
