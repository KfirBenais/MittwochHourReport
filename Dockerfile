FROM node:22-alpine
WORKDIR /app
COPY package.json server.js mailer.js ./
COPY public ./public
ENV PORT=8080 DATA_DIR=/data TZ=Asia/Jerusalem
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "server.js"]
