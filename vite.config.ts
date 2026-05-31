import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        home: "index.html",
        evaluator: "evaluator.html",
        creator: "creator.html",
        human: "human.html",
        studio: "studio.html",
        results: "results.html"
      }
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"]
  }
});
