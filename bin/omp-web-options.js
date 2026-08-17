"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}


function printHelp() {
  console.log(`Usage: ompweb [options]

Options:
  -p, --port <port>        Server port (default 30177, env PORT)
  -H, --hostname <host>    Bind hostname (default 127.0.0.1, env OMP_WEB_HOSTNAME)
      --password <pass>    Basic Auth password (username: omp, env OMP_WEB_PASSWORD)
      --no-open            Do not open the browser automatically
  -h, --help               Show this help
      --version            Show version

Password:
  ompweb --password "a-long-random-password"
  # env-variable forms (POSIX, PowerShell, CMD handled uniformly)
  OMP_WEB_PASSWORD="secret" ompweb
  $env:OMP_WEB_PASSWORD="secret"; ompweb   # PowerShell
  set OMP_WEB_PASSWORD=secret&& ompweb     # CMD

Security: Basic Auth does not encrypt traffic — use HTTPS via a trusted
reverse proxy or VPN when binding to a non-loopback hostname.`);
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port:      { type: "string", short: "p" },
      hostname:  { type: "string", short: "H" },
      password:  { type: "string" },
      help:      { type: "boolean", short: "h" },
      version:   { type: "boolean" },
      "no-open": { type: "boolean" },
    },
    strict: false,
  });

  // --password wins over env so Windows users without POSIX inline-env syntax have a first-class option.
  const password = cliArgs.password ?? env.OMP_WEB_PASSWORD;
  if (cliArgs.version) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require("../package.json");
      console.log(pkg.version ?? "0.0.0");
    } catch { console.log("0.0.0"); }
    return {
      port: cliArgs.port ?? env.PORT ?? "30177",
      hostname: cliArgs.hostname ?? env.OMP_WEB_HOSTNAME ?? "127.0.0.1",
      password,
      openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMP_WEB_NO_OPEN),
      version: true,
    };
  }
  // Expose help flag without exiting here — caller (bin/omp-web.js) decides
  // whether to exit, keeping parseLaunchOptions testable. Print here so
  // --help works even when the caller is a test.
  if (cliArgs.help) {
    printHelp();
    return {
      port: cliArgs.port ?? env.PORT ?? "30177",
      hostname: cliArgs.hostname ?? env.OMP_WEB_HOSTNAME ?? "127.0.0.1",
      password,
      openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMP_WEB_NO_OPEN),
      help: true,
    };
  }
  return {
    port: cliArgs.port ?? env.PORT ?? "30177",
    hostname: cliArgs.hostname ?? env.OMP_WEB_HOSTNAME ?? "127.0.0.1",
    password,
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMP_WEB_NO_OPEN),
  };
}

module.exports = { parseLaunchOptions };
