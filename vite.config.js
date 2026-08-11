import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * O projeto tem duas paginas:
 *  - index.html      -> a UI do popover (o painel de combate).
 *  - background.html -> pagina invisivel que o Owlbear carrega junto com a sala
 *                       (via "background_url" no manifest). E ela quem registra
 *                       o menu de contexto, para que ele exista mesmo com o
 *                       popover fechado.
 */
export default defineConfig({
  // O manifest usa caminhos absolutos ("/", "/icon.svg"), entao a base precisa
  // continuar sendo a raiz do dominio.
  base: "/",
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        background: fileURLToPath(new URL("./background.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    // O Owlbear carrega a extensao dentro de um iframe de outra origem.
    cors: true,
  },
});
