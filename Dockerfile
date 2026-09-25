FROM node:20-alpine

ARG GUAC_VERSION=1.6.0

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

RUN apk add --no-cache --virtual .fetch curl unzip \
  && mkdir -p /app/public/vendor \
  && curl -fsSL "https://downloads.apache.org/guacamole/${GUAC_VERSION}/binary/guacamole-${GUAC_VERSION}.war" -o /tmp/guac.war \
  && unzip -j /tmp/guac.war "guacamole-common-js/all.min.js" -d /app/public/vendor \
  && rm /tmp/guac.war \
  && apk del .fetch \
  && chown -R node:node /app

ENV NODE_ENV=production
EXPOSE 9080 9443
USER node
CMD ["node", "src/server.js"]
