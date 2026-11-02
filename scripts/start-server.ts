import { spawn } from "node:child_process";

console.log("[Server]: Running database migrations...");
const migrate = spawn("npm", ["run", "db:migrate"], { stdio: "inherit", shell: true });

migrate.on("exit", (code) => {
  if (code !== 0) {
    console.error(`[Server]: Database migration failed with exit code ${code}`);
    process.exit(code ?? 1);
  }

  console.log("[Server]: Starting background story worker daemon...");
  const worker = spawn("npm", ["run", "worker"], { stdio: "inherit", shell: true });

  worker.on("error", (err) => {
    console.error("[Server Worker Error]:", err);
  });

  console.log("[Server]: Starting Next.js web application...");
  const next = spawn("npx", ["next", "start", "--hostname", "0.0.0.0"], { stdio: "inherit", shell: true });

  next.on("error", (err) => {
    console.error("[Server Next Error]:", err);
  });

  const cleanup = () => {
    console.log("[Server]: Shutting down worker and web server...");
    try { worker.kill("SIGTERM"); } catch {}
    try { next.kill("SIGTERM"); } catch {}
  };

  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  next.on("exit", (nextCode) => {
    try { worker.kill("SIGTERM"); } catch {}
    process.exit(nextCode ?? 0);
  });
});
