FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY test ./test
RUN node --test
CMD ["node", "--test"]
