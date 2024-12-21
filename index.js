const express = require("express")
const http = require("http")

const server = express()

const PORT = process.env.PORT || 3000;

server.use(express.json());

server.get("/", (req, res) => {
  res.status(200).send({ status: "Gitops", level: "1.0" });
});

server.get("/health", (req, res) => {
  res.status(200).send({ status: "Application is Healthy", timestamp: new Date() });
});

// Endpoint to display secret (for testing updates)
server.get("/app-name", (req, res) => {
  const appName = process.env.APP_NAME || null;

  res.status(200).send({ application_name: appName });
});


http.createServer(server).listen(PORT, () => console.log(`Demo application starting on port ${PORT} 🧨`))