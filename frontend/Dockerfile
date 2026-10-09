# syntax=docker/dockerfile:1
#
# Configurator web app: built with Vite, served as static files by nginx.
#
#   docker build -t configurator-web --build-arg VITE_API_BASE=https://<api host> frontend
#   docker run -p 8080:8080 configurator-web
#
# VITE_API_BASE is compiled into the bundle, so it is a build argument rather than a
# run-time variable: build one image per environment, pointing at that environment's API.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
