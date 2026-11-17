// PM2 production process definitions — StorageApp backend.
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save && pm2 startup
// Runs from the backend directory; expects a populated `.env` file there.
//
//   backend   : Express API (app.js)                   — single instance, fork
//   scheduler : registers the 9 BullMQ repeatable jobs — run exactly ONE
//   worker    : consumes the queue                     — scale horizontally
const path = require("path");
module.exports = {
  apps: [
    {
      name: "backend",
      script: "app.js",
      cwd: __dirname,
      node_args: `--env-file=${path.join(__dirname, ".env")} --max-old-space-size=120`,
      instances: 2,
      exec_mode: "cluster",
      autorestart: true,
      max_memory_restart: "300M",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 4000,
      },
    },
    {
      name: "scheduler",
      script: "jobs/queueJobs.js",
      args: "scheduler",
      cwd: __dirname,
      node_args: `--env-file=${path.join(__dirname, ".env")} --max-old-space-size=120`,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "200M",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 4000,
      },
    },
    {
      name: "worker",
      script: "jobs/queueJobs.js",
      args: "worker",
      cwd: __dirname,
      node_args: `--env-file=${path.join(__dirname, ".env")} --max-old-space-size=120`,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "300M",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 4000,
      },
    },
  ],
};
