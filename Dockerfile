FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY web/ ./
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
COPY Demo/ ./Demo/
ENV Arduino__Enabled=false
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "LagerDemo.dll"]
