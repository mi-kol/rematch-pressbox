import { sbAdmin } from "../../../packages/core/src/db.js";
import { generateRecapFromPacket } from "../../../packages/core/src/recap.js";
import { publishToWorld } from "../../../packages/core/src/publish.js";

export function buildCtx() {
  return {
    sb: sbAdmin(),
    generateRecapFromPacket,
    publishToWorld,
    cfg: {
      blogBaseUrl: process.env.BLOG_BASE_URL || "https://knowball.netlify.app",
    },
  };
}
