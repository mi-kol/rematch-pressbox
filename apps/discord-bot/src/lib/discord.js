export function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function safeReply(interaction, content) {
  if (!interaction.isRepliable()) return;
  if (interaction.deferred || interaction.replied) return interaction.followUp(content).catch(() => {});
  return interaction.reply(content).catch(() => {});
}
