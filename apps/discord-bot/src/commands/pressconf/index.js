import { execute as latest } from "./latest.js";
import { execute as republish } from "./republish.js";

export const name = "pressconf";

export async function execute(interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  if (sub === "latest") return latest(interaction, ctx);
  if (sub === "republish") return republish(interaction, ctx);
  return interaction.reply({ content: "unknown subcommand", ephemeral: true });
}
