"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require("net");

function isPortAvailable(port, hostname) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
      } else {
        reject(error);
      }
    });

    server.listen({ port: Number(port), host: hostname }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });
}

module.exports = { isPortAvailable };
