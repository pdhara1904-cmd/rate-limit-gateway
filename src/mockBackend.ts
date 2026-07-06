import express from "express";

/**
 * A tiny stand-in "upstream API" so the gateway has something real to
 * proxy requests to. In a real deployment this would be your actual
 * product's backend (user service, orders service, whatever) — the
 * gateway doesn't need to know or care what's behind it.
 */
const app = express();
const PORT = 4000;

app.get("/api/hello", (_req, res) => {
  res.json({ message: "Hello from the upstream backend!", servedAt: new Date().toISOString() });
});

app.get("/api/data/:id", (req, res) => {
  res.json({ id: req.params.id, value: Math.random(), servedAt: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[mock-backend] listening on http://localhost:${PORT}`);
});
