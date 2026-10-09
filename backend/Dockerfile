# syntax=docker/dockerfile:1
#
# Configurator API (ASP.NET Core 8).
#
#   docker build -t configurator-api backend
#   docker run -p 8080:8080 \
#     -e ConnectionStrings__Default="..." \
#     -e Jwt__SigningKey="<32+ random chars>" \
#     -e Storage__ConnectionString="<Azure Storage connection string>" \
#     -e Cors__Origins__0="https://<web host>" \
#     configurator-api
#
# Configuration is read from environment variables (double underscore = nested key), so
# nothing secret is baked into the image. The Storage account, SQL database and secrets
# are provisioned by the deployment pipeline, not by this file. The schema is applied on
# startup, and GET /health is the probe endpoint.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Restore first, on the project file alone, so the package layer is cached until a
# dependency actually changes.
COPY src/Configurator.Api/Configurator.Api.csproj src/Configurator.Api/
RUN dotnet restore src/Configurator.Api/Configurator.Api.csproj

COPY src/ src/
RUN dotnet publish src/Configurator.Api/Configurator.Api.csproj \
      -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production

# The runtime image ships a non-root "app" user; there is no reason to run as root.
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Configurator.Api.dll"]
