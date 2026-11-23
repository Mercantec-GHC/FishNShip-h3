# FishNShip-h3

Lokal maskindemo til fischertechnik Automated High-Bay Warehouse 24 V (536631) og Arduino Portenta Machine Control.

## Start på localhost

Kør fra roden af repoet med .NET 10 SDK:

```sh
dotnet run --project web/LagerDemo.csproj
```

Docker Desktop kan også køre demoen med `docker compose up --build`.

Åbn [localhost:5080](http://localhost:5080/). Vælg en plads i reolen og læg et emne ind. Klik **Hent fra** for at hente emnet ud igen. Indgangene og hændelsesloggen viser de simulerede signaler undervejs.

## Se signaler fra den fysiske maskine

1. Åbn `Demo/Demo.ino` i Arduino IDE. Vælg **Arduino Portenta H7** med **Main Core**, og brug biblioteket `Arduino_PortentaMachineControl`. Upload skitsen til jeres Portenta.
2. Luk **Serial Monitor**, hvis den er åben. Åbn localhost i **Chrome eller Edge** på den computer, hvor Arduino er tilsluttet via USB.
3. Klik **Tilslut Arduino**, og vælg Portentas COM-port. Tabellen viser DI0–DI7 som rå `0`/`1`-niveauer. Sammenhold kanalnumrene med jeres faktiske ledningsføring. Afbryd forbindelsen i demoen, før I åbner Serial Monitor eller uploader igen.

Arduino sender alle otte indgange samlet hvert 200 ms ved 115200 baud. Browseren læser USB-serieporten med Web Serial. Simuleringen efterligner lagerarbejdet, mens livevisningen læser Portentas digitale indgange. Encoderpulser og analoge sensorer indgår ikke i aflæsningen. Skitsen sender ingen signaler til motorudgangene.

## Dokumentation

- [fischertechnik 536631, datablad og signalliste](https://fiproductmedia.azureedge.net/media/Certification%20Documents/Technical%20Datasheets/fischertechnik/TDB_536631-AUTOMATISIERTES_HOCHREGAL_24V.pdf)
- [Arduino Portenta Machine Control, brugermanual](https://docs.arduino.cc/tutorials/portenta-machine-control/user-manual/)
