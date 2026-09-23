# tcc-frontend

SPA Vite/React para os dashboards do TCC. Em desenvolvimento, defina `VITE_API_BASE_URL` como a origem do `tcc-backend` e execute `pnpm install && pnpm dev`.

Para produção, o `Dockerfile` gera `dist` e o Nginx serve a SPA com fallback para `index.html`. Passe `--build-arg VITE_API_BASE_URL=https://api.exemplo.com` ao construir a imagem.
