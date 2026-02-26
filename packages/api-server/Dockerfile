FROM infosys-harbor.mihoyo.com/base-image/node:v1.1.5-beta.4
RUN n 22.18.0
RUN npm i -g bun
COPY ../../ /app
EXPOSE 4000
ENTRYPOINT ["/bin/sh", "-c", "/nodejs-startup && chmod +x node-init.sh && bash ./node-init.sh bun --filter ./packages/api-server start"]
