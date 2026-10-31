FROM node:24-alpine AS frontend-dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM node:24-alpine AS frontend-build
WORKDIR /app
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_LOCAL_AUTH_ENABLED=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_LOCAL_AUTH_ENABLED=$VITE_LOCAL_AUTH_ENABLED
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx/nginx-unprivileged:1.30.6-alpine3.24 AS production
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
