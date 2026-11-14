import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rafael =
    env.VITE_API_BASE?.replace(/\/$/, "") ||
    "https://merger-fish-gets-peace.trycloudflare.com";

  return {
    server: {
      port: 5173,
      proxy: {
        // Cobros + SSE + voz (TTS/STT) → Rafael. Paths relativos en DEV.
        "/api/cobros": {
          target: rafael,
          changeOrigin: true,
          secure: true,
        },
        "/api/eventos": {
          target: rafael,
          changeOrigin: true,
          secure: true,
        },
        "/api/tts": {
          target: rafael,
          changeOrigin: true,
          secure: true,
        },
        "/api/stt": {
          target: rafael,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
