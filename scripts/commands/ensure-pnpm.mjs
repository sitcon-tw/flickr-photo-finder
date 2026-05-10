const userAgent = process.env.npm_config_user_agent || "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("This project uses pnpm as its only package manager.");
  console.error("Use `pnpm install` and `pnpm <script>` commands instead of npm or yarn.");
  process.exit(1);
}
