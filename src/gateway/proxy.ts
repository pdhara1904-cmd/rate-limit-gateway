import { createProxyMiddleware } from "http-proxy-middleware";
import { config } from "../config";

/**
 * The reverse proxy: once a request passes the rate limiter, this forwards
 * it on to the real backend and streams the response back to the client.
 * This is what makes the service a "gateway" rather than just a limiter —
 * clients only ever talk to this service; it's the single entry point.
 */
export const proxyMiddleware = createProxyMiddleware({
  target: config.backendUrl,
  changeOrigin: true,
  logger: console,
});
