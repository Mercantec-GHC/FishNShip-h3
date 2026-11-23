FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY web/ ./
RUN dotnet publish -c Release -o /app

FROM debian:bookworm-slim AS arduino
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b https://github.com/arduino/arduino-cli/releases/download/v1.5.1/arduino-cli_1.5.1_Linux_64bit.tar.gz /tmp/arduino-cli.tar.gz
RUN tar -xzf /tmp/arduino-cli.tar.gz -C /usr/local/bin arduino-cli
ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/sketchbook \
    ARDUINO_DIRECTORIES_DOWNLOADS=/tmp/arduino-downloads \
    ARDUINO_METRICS_ENABLED=false
RUN arduino-cli core update-index \
    && arduino-cli lib update-index \
    && arduino-cli core install arduino:mbed_portenta@4.6.0 \
    && arduino-cli lib install --no-deps ArduinoRS485@1.1.1 Arduino_PortentaMachineControl@1.0.5

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
COPY Demo/ ./Demo/
ENV Arduino__Enabled=false
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "LagerDemo.dll"]

FROM runtime AS hosted
COPY --from=arduino /usr/local/bin/arduino-cli /usr/local/bin/arduino-cli
COPY --from=arduino /opt/arduino /opt/arduino
ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/sketchbook \
    ARDUINO_DIRECTORIES_DOWNLOADS=/tmp/arduino-downloads \
    ARDUINO_METRICS_ENABLED=false \
    DOTNET_EnableDiagnostics=0

FROM runtime AS local
