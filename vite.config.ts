import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// 两个独立入口：设置窗口 index.html，提醒浮窗 toast.html。
// 浮窗只打包自己用到的代码，打开更快、占用更少。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // 不监听 Rust 目录：编译出的 exe 被锁定时，Windows 上监听会报 EBUSY 并让 Vite 退出。
    // Rust 代码的变化由 tauri dev 自己监听和重新编译。
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2021",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        toast: resolve(__dirname, "toast.html"),
        bar: resolve(__dirname, "bar.html"),
      },
    },
  },
});
