const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://lfcode.ai" : stage === "dev" ? "https://dev.lfcode.ai" : `https://${stage}.dev.lfcode.ai`,
  console:
    stage === "production"
      ? "https://lfcode.ai/auth"
      : stage === "dev"
        ? "https://dev.lfcode.ai/auth"
        : `https://${stage}.dev.lfcode.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/lfyxhappy/lfcode",
  discord: "https://discord.gg/lfcode",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
